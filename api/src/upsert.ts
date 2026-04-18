/**
 * D1 upsert helpers — port of `build_db.py`'s insert logic, restricted to
 * the subset needed for incremental ingest from Discord.
 *
 * Milestone 2: messages + users + channels.
 * Milestone 3: attachments, reactions, embeds, threads.
 */

import type {
	DiscordChannel,
	DiscordMessage,
	DiscordUser,
} from "./discord"

function chunk<T>(arr: T[], size: number): T[][] {
	if (arr.length <= size) return [arr]
	const out: T[][] = []
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
	return out
}

async function batched(db: D1Database, stmts: D1PreparedStatement[]): Promise<number> {
	if (stmts.length === 0) return 0
	let total = 0
	// D1 batch caps at ~100 statements per call; chunk to be safe.
	for (const piece of chunk(stmts, 50)) {
		const results = await db.batch(piece)
		total += results.reduce((acc, r) => acc + (r.meta?.changes ?? 0), 0)
	}
	return total
}

/** Fast batched upsert of users. Skips entries with no `id`. */
export async function upsertUsers(
	db: D1Database,
	users: Iterable<DiscordUser | null | undefined>,
): Promise<void> {
	const stmts: D1PreparedStatement[] = []
	const seen = new Set<string>()
	const stmt = db.prepare(
		"INSERT OR REPLACE INTO users (id, username, global_name, avatar) VALUES (?, ?, ?, ?)",
	)
	for (const u of users) {
		if (!u?.id || seen.has(u.id)) continue
		seen.add(u.id)
		stmts.push(stmt.bind(u.id, u.username ?? null, u.global_name ?? null, u.avatar ?? null))
	}
	if (stmts.length) await db.batch(stmts)
}

/** Upsert a channel row (called once per channel touched in a tick). */
export async function upsertChannel(
	db: D1Database,
	ch: DiscordChannel,
): Promise<void> {
	await db
		.prepare(
			"INSERT OR REPLACE INTO channels (id, name, type, position) VALUES (?, ?, ?, ?)",
		)
		.bind(ch.id, ch.name, ch.type, ch.position ?? 0)
		.run()
}

/** Bulk-insert messages with INSERT OR IGNORE (idempotent). */
export async function insertMessages(
	db: D1Database,
	messages: DiscordMessage[],
): Promise<number> {
	if (messages.length === 0) return 0
	const stmt = db.prepare(
		`INSERT OR IGNORE INTO messages
       (id, channel_id, author_id, content, timestamp, edited_timestamp,
        type, flags, pinned, reference_message_id, reference_channel_id, thread_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	const stmts = messages.map((m) =>
		stmt.bind(
			m.id,
			m.channel_id,
			m.author?.id ?? null,
			m.content ?? "",
			m.timestamp,
			m.edited_timestamp,
			m.type ?? 0,
			m.flags ?? 0,
			m.pinned ? 1 : 0,
			m.message_reference?.message_id ?? null,
			m.message_reference?.channel_id ?? null,
			m.thread?.id ?? null,
		),
	)
	return batched(db, stmts)
}

/** INSERT OR IGNORE attachment metadata for new messages. Binary not downloaded. */
export async function insertAttachments(
	db: D1Database,
	messages: DiscordMessage[],
): Promise<number> {
	const stmt = db.prepare(
		`INSERT OR IGNORE INTO attachments
       (id, message_id, filename, content_type, size, url, proxy_url, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	const stmts: D1PreparedStatement[] = []
	for (const m of messages) {
		for (const a of m.attachments ?? []) {
			stmts.push(stmt.bind(
				a.id, m.id, a.filename ?? "unknown", a.content_type ?? null,
				a.size ?? null, a.url ?? null, a.proxy_url ?? null,
				a.width ?? null, a.height ?? null,
			))
		}
	}
	return batched(db, stmts)
}

/** INSERT OR REPLACE reactions (counts can change). */
export async function insertReactions(
	db: D1Database,
	messages: DiscordMessage[],
): Promise<number> {
	const stmt = db.prepare(
		`INSERT OR REPLACE INTO reactions (message_id, emoji_name, emoji_id, count)
     VALUES (?, ?, ?, ?)`,
	)
	const stmts: D1PreparedStatement[] = []
	for (const m of messages) {
		for (const r of m.reactions ?? []) {
			stmts.push(stmt.bind(
				m.id, r.emoji?.name ?? "", r.emoji?.id ?? null, r.count ?? 0,
			))
		}
	}
	return batched(db, stmts)
}

/** INSERT embeds. The embeds table uses an autoinc rowid; no dedup column. */
export async function insertEmbeds(
	db: D1Database,
	messages: DiscordMessage[],
): Promise<number> {
	const stmt = db.prepare(
		`INSERT INTO embeds
       (message_id, type, title, description, url, thumbnail_url,
        thumbnail_width, thumbnail_height, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	const stmts: D1PreparedStatement[] = []
	for (const m of messages) {
		for (const e of m.embeds ?? []) {
			stmts.push(stmt.bind(
				m.id, e.type ?? null, e.title ?? null, e.description ?? null,
				e.url ?? null, e.thumbnail?.url ?? null,
				e.thumbnail?.width ?? null, e.thumbnail?.height ?? null,
				e.image?.url ?? null,
			))
		}
	}
	return batched(db, stmts)
}

/** Upsert thread metadata for any messages that created threads. */
export async function upsertThreadsFromMessages(
	db: D1Database,
	messages: DiscordMessage[],
): Promise<number> {
	const stmt = db.prepare(
		`INSERT OR REPLACE INTO threads
       (id, parent_message_id, parent_channel_id, name,
        message_count, member_count, archived, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	const stmts: D1PreparedStatement[] = []
	for (const m of messages) {
		const t = m.thread
		if (!t) continue
		stmts.push(stmt.bind(
			t.id, m.id, m.channel_id, t.name ?? null,
			t.message_count ?? null, t.member_count ?? null,
			t.thread_metadata?.archived ? 1 : 0,
			t.thread_metadata?.locked ? 1 : 0,
		))
	}
	return batched(db, stmts)
}

/** Read the latest snowflake per channel from D1; missing channels return null. */
export async function latestMessageIdsByChannel(
	db: D1Database,
): Promise<Map<string, string>> {
	const { results } = await db
		.prepare("SELECT channel_id, MAX(id) AS max_id FROM messages GROUP BY channel_id")
		.all<{ channel_id: string; max_id: string }>()
	const out = new Map<string, string>()
	for (const r of results) out.set(r.channel_id, r.max_id)
	return out
}

export interface SyncRun {
	id: string
	finished_at: string
	source: "cfw" | "gha" | "cli"
	run_url?: string | null
	messages_added: number
	duration_ms: number
	status: "ok" | "error"
}

/** Append a row to the sync_runs log. */
export async function recordSyncRun(db: D1Database, row: SyncRun): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sync_runs (id, finished_at, source, run_url, messages_added, duration_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			row.id,
			row.finished_at,
			row.source,
			row.run_url ?? null,
			row.messages_added,
			row.duration_ms,
			row.status,
		)
		.run()
}
