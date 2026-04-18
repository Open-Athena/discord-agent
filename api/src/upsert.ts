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
	const results = await db.batch(stmts)
	// `meta.changes` reports the row count actually written (0 for ignored dupes).
	return results.reduce((acc, r) => acc + (r.meta?.changes ?? 0), 0)
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
