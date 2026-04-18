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
}

/** Perform a Discord API GET, retrying on 429. Returns parsed JSON or null on 403. */
async function apiGet<T>(path: string, token: string): Promise<T | null> {
	// Bounded retry loop: each 429 waits `retry_after` and tries again. Cap at 5
	// retries to avoid pathological spins.
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(`${BASE}${path}`, {
			headers: {
				Authorization: `Bot ${token}`,
				"User-Agent": UA,
			},
		})
		if (res.status === 429) {
			const body = (await res.json()) as { retry_after?: number }
			const waitMs = Math.ceil((body.retry_after ?? 5) * 1000) + 500
			console.warn(`[discord] 429 on ${path}, waiting ${waitMs}ms`)
			await new Promise((r) => setTimeout(r, waitMs))
			continue
		}
		if (res.status === 403) return null
		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Discord ${res.status} on ${path}: ${text.slice(0, 200)}`)
		}
		return (await res.json()) as T
	}
	throw new Error(`Discord: exhausted 429 retries on ${path}`)
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
