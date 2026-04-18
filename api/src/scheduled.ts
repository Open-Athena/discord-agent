/**
 * Cron handler — incrementally update D1 from Discord.
 *
 * Per tick: list the guild's text channels, find each channel's max
 * snowflake in D1, fetch newer messages from Discord, upsert. Idempotent;
 * safe to run alongside the GHA pipeline.
 *
 * Milestone 2 scope: messages + users + channels only. Attachments,
 * reactions, embeds, threads (M3) and type-21 thread recursion are TODO.
 */

import {
	fetchGuildChannels,
	paginateNewMessages,
	TEXT_CHANNEL_TYPES,
} from "./discord"
import {
	insertMessages,
	latestMessageIdsByChannel,
	recordSyncRun,
	upsertChannel,
	upsertUsers,
} from "./upsert"

interface Env {
	DB: D1Database
	GUILD_ID?: string
	DISCORD_TOKEN?: string
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
	const channels = await fetchGuildChannels(guildId, token)
	const textChannels = channels
		.filter((c) => TEXT_CHANNEL_TYPES.has(c.type))
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

	let totalNew = 0
	const touched: string[] = []
	for (const ch of textChannels) {
		const after = cursors.get(ch.id) ?? null
		const newMsgs = await paginateNewMessages(ch.id, after, token)
		if (newMsgs.length === 0) continue

		await upsertChannel(env.DB, ch)
		await upsertUsers(env.DB, newMsgs.map((m) => m.author).filter(Boolean) as NonNullable<typeof newMsgs[number]["author"]>[])
		const inserted = await insertMessages(env.DB, newMsgs)
		totalNew += inserted
		touched.push(`#${ch.name}=+${inserted}`)
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
		`[cron] +${totalNew} msgs across ${touched.length}/${textChannels.length} channels` +
			` in ${elapsed}ms` +
			(touched.length ? ` (${touched.join(", ")})` : ""),
	)
}
