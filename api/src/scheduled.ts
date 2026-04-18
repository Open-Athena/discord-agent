/**
 * Cron handler — incrementally update D1 from Discord.
 *
 * Per tick: list the guild's text channels + active threads, find each
 * channel's max snowflake in D1, fetch newer messages from Discord,
 * upsert. Idempotent; safe to run alongside the GHA pipeline.
 */

import type { DiscordChannel } from "./discord"
import {
	fetchActiveThreads,
	fetchGuildChannels,
	paginateNewMessages,
	TEXT_CHANNEL_TYPES,
} from "./discord"
import {
	insertAttachments,
	insertEmbeds,
	insertMessages,
	insertReactions,
	latestMessageIdsByChannel,
	recordSyncRun,
	upsertChannel,
	upsertThreadsFromMessages,
	upsertUsers,
} from "./upsert"

interface Env {
	DB: D1Database
	GUILD_ID?: string
	DISCORD_TOKEN?: string
}

// Fetch concurrency: Discord's global bot limit is ~50 req/s. At ~100-300ms
// per /messages call, 5 in flight is well under the ceiling; goes faster
// in practice via HTTP/2 multiplexing. If we hit 429s, the fetch retry
// loop (discord.ts) handles it.
const FETCH_CONCURRENCY = 5

/** Run `fn` on each item with at most `limit` in flight; preserves order. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	let cursor = 0
	async function worker() {
		while (true) {
			const i = cursor++
			if (i >= items.length) return
			results[i] = await fn(items[i], i)
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

export async function scheduled(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	const t0 = Date.now()
	const guildId = env.GUILD_ID
	const token = env.DISCORD_TOKEN
	if (!guildId || !token) {
		console.warn(
			`[cron] skip: GUILD_ID=${guildId ? "set" : "unset"} DISCORD_TOKEN=${token ? "set" : "unset"}`,
		)
		return
	}

	console.log(`[cron] tick at ${new Date(event.scheduledTime).toISOString()}`)

	const cursors = await latestMessageIdsByChannel(env.DB)
	const [parentChannels, activeThreads] = await Promise.all([
		fetchGuildChannels(guildId, token),
		fetchActiveThreads(guildId, token),
	])
	// Iterate parents (text-like) + active threads. Already-archived threads
	// in D1 won't be re-fetched unless they appear here, but they're frozen
	// by definition — D1 is correct.
	const seen = new Set<string>()
	const channelList = [...parentChannels.filter((c) => TEXT_CHANNEL_TYPES.has(c.type)), ...activeThreads]
		.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

	// Parallelize the Discord fetches across channels. Each worker handles a
	// channel end-to-end (fetch -> D1 writes) so rows land in the order
	// we'd see them serially from Discord's perspective.
	interface PerChannelResult {
		channel: DiscordChannel
		inserted: number
	}
	let skipped = 0
	const perChannel = await mapLimit(channelList, FETCH_CONCURRENCY, async (ch): Promise<PerChannelResult> => {
		const after = cursors.get(ch.id) ?? null
		// Skip the fetch when Discord's own last_message_id is already in D1.
		// Snowflake IDs are monotonic, so BigInt comparison gives ordering.
		if (after && ch.last_message_id && BigInt(ch.last_message_id) <= BigInt(after)) {
			skipped++
			return { channel: ch, inserted: 0 }
		}
		const newMsgs = await paginateNewMessages(ch.id, after, token)
		if (newMsgs.length === 0) return { channel: ch, inserted: 0 }

		await upsertChannel(env.DB, ch)
		await upsertUsers(env.DB, newMsgs.map((m) => m.author).filter(Boolean) as NonNullable<typeof newMsgs[number]["author"]>[])
		const inserted = await insertMessages(env.DB, newMsgs)
		await Promise.all([
			insertAttachments(env.DB, newMsgs),
			insertReactions(env.DB, newMsgs),
			insertEmbeds(env.DB, newMsgs),
			upsertThreadsFromMessages(env.DB, newMsgs),
		])
		return { channel: ch, inserted }
	})

	const touched: string[] = []
	let totalNew = 0
	for (const { channel, inserted } of perChannel) {
		if (inserted > 0) {
			touched.push(`#${channel.name}=+${inserted}`)
			totalNew += inserted
		}
	}

	const elapsed = Date.now() - t0
	const finishedAt = new Date().toISOString()
	await recordSyncRun(env.DB, {
		id: `cfw:${finishedAt}`,
		finished_at: finishedAt,
		source: "cfw",
		messages_added: totalNew,
		duration_ms: elapsed,
		status: "ok",
	})

	console.log(
		`[cron] +${totalNew} msgs across ${touched.length}/${channelList.length} channels` +
			` (${skipped} skipped via last_message_id)` +
			` in ${elapsed}ms` +
			(touched.length ? ` (${touched.join(", ")})` : ""),
	)
}
