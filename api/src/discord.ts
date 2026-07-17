/**
 * Minimal Discord REST client for the CFW scheduled handler.
 *
 * Scope: list a guild's channels, paginate a channel's messages using the
 * `after=<snowflake>` cursor. Handles 429s by honoring `retry_after`.
 */

const BASE = "https://discord.com/api/v10"
const UA = "discord-archive-cfw (+https://github.com/Open-Athena/discord-agent, 0.2)"

// Text-like channel types: text(0), announcement(5), announcement thread(10),
// public thread(11), private thread(12).
export const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12])
export const PRIVATE_THREAD = 12
const VIEW_CHANNEL = 1n << 10n

/**
 * True iff @everyone (role id == guild id) is not denied VIEW_CHANNEL —
 * i.e. the channel is not "Private" in Discord's UI. Mirrors `is_public`
 * in the top-level `archive.py`.
 */
export function isPublic(ch: DiscordChannel, guildId: string): boolean {
	for (const ow of ch.permission_overwrites ?? []) {
		if (ow.id === guildId && (BigInt(ow.deny ?? "0") & VIEW_CHANNEL) !== 0n) return false
	}
	return true
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504])
const MAX_RETRIES = 3

export interface DiscordUser {
	id: string
	username: string
	global_name: string | null
	avatar: string | null
}

export interface DiscordAttachment {
	id: string
	filename?: string
	content_type?: string
	size?: number
	url?: string
	proxy_url?: string
	width?: number
	height?: number
}

export interface DiscordReaction {
	count: number
	emoji: { id: string | null; name: string }
}

export interface DiscordEmbed {
	type?: string
	title?: string
	description?: string
	url?: string
	thumbnail?: { url?: string; width?: number; height?: number }
	image?: { url?: string }
}

export interface DiscordThreadInline {
	id: string
	name?: string
	message_count?: number
	member_count?: number
	thread_metadata?: { archived?: boolean; locked?: boolean }
}

export interface DiscordMessage {
	id: string
	channel_id: string
	author: DiscordUser | null
	content: string
	timestamp: string
	edited_timestamp: string | null
	type: number
	flags?: number
	pinned?: boolean
	message_reference?: { message_id?: string; channel_id?: string }
	thread?: DiscordThreadInline
	attachments?: DiscordAttachment[]
	reactions?: DiscordReaction[]
	embeds?: DiscordEmbed[]
}

export interface DiscordChannel {
	id: string
	name: string
	type: number
	position?: number
	// Present on threads: the parent channel's id.
	parent_id?: string | null
	// Present on guild channels: per-role/member permission overrides.
	permission_overwrites?: { id: string; type: number; allow?: string; deny?: string }[]
	// Present on text-like channels / threads. Lets us skip fetching when
	// Discord's own "newest message id" is already <= our D1 cursor.
	last_message_id?: string | null
}

/**
 * Perform a Discord API GET with 429 backoff + 3x exp-backoff retry on 5xx
 * and network errors. Returns parsed JSON or null on 403. 429 retries use
 * `retry_after` and are bounded separately (cap 5).
 */
async function apiGet<T>(path: string, token: string): Promise<T | null> {
	let attempt = 0
	let retries429 = 0
	while (true) {
		let res: Response
		try {
			res = await fetch(`${BASE}${path}`, {
				headers: { Authorization: `Bot ${token}`, "User-Agent": UA },
			})
		} catch (e) {
			if (attempt >= MAX_RETRIES) throw e
			await backoff(attempt, `network error on ${path}: ${String(e)}`)
			attempt++
			continue
		}
		if (res.status === 429) {
			if (retries429 >= 5) throw new Error(`Discord: exhausted 429 retries on ${path}`)
			const body = (await res.json()) as { retry_after?: number }
			const waitMs = Math.ceil((body.retry_after ?? 5) * 1000) + 500
			console.warn(`[discord] 429 on ${path}, waiting ${waitMs}ms`)
			await new Promise((r) => setTimeout(r, waitMs))
			retries429++
			continue
		}
		if (res.status === 403) return null
		if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
			await backoff(attempt, `${res.status} on ${path}`)
			attempt++
			continue
		}
		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Discord ${res.status} on ${path}: ${text.slice(0, 200)}`)
		}
		return (await res.json()) as T
	}
}

async function backoff(attempt: number, msg: string): Promise<void> {
	const waitMs = Math.round((2 ** attempt + Math.random() * 0.5) * 1000)
	console.warn(`[discord] ${msg}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`)
	await new Promise((r) => setTimeout(r, waitMs))
}

export async function fetchGuildChannels(
	guildId: string,
	token: string,
): Promise<DiscordChannel[]> {
	const channels = await apiGet<DiscordChannel[]>(
		`/guilds/${guildId}/channels`,
		token,
	)
	if (!channels) throw new Error(`fetchGuildChannels: 403 for guild ${guildId}`)
	return channels
}

/** Fetch all active (non-archived) threads in the guild. */
export async function fetchActiveThreads(
	guildId: string,
	token: string,
): Promise<DiscordChannel[]> {
	const body = await apiGet<{ threads: DiscordChannel[] }>(
		`/guilds/${guildId}/threads/active`,
		token,
	)
	return body?.threads ?? []
}

/** Fetch up to 100 messages newer than `afterId` (null = newest 100). */
export async function fetchMessagesAfter(
	channelId: string,
	afterId: string | null,
	token: string,
): Promise<DiscordMessage[] | null> {
	const qs = new URLSearchParams({ limit: "100" })
	if (afterId) qs.set("after", afterId)
	return apiGet<DiscordMessage[]>(
		`/channels/${channelId}/messages?${qs}`,
		token,
	)
}

/**
 * Paginate forward from `afterId` until Discord returns <100. Discord's
 * `?after=X` endpoint returns up to 100 messages with `id > X`, ordered
 * newest-first within the batch but covering the oldest window after X — so
 * advancing the cursor to `batch[0].id` (the newest in the batch) fetches
 * the next, newer window. Returns all new messages sorted chronologically
 * (oldest first).
 */
export async function paginateNewMessages(
	channelId: string,
	afterId: string | null,
	token: string,
): Promise<DiscordMessage[]> {
	const all: DiscordMessage[] = []
	let cursor = afterId
	for (let page = 0; page < 50; page++) {
		const batch = await fetchMessagesAfter(channelId, cursor, token)
		if (batch === null) return [] // 403: no access
		if (batch.length === 0) break
		all.push(...batch)
		cursor = batch[0].id
		if (batch.length < 100) break
	}
	all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	return all
}
