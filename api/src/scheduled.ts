/**
 * Cron handler — incrementally update D1 from Discord.
 *
 * Milestone 1: scaffolding only. Logs a tick; no Discord calls, no DB writes.
 * Milestone 2: will port archive.py's per-channel `after=<snowflake>` fetch
 * and upsert into D1.
 */

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
	const guildId = env.GUILD_ID || "(unset)"
	const hasToken = Boolean(env.DISCORD_TOKEN)

	console.log(
		`[cron] tick at ${new Date(event.scheduledTime).toISOString()} ` +
			`guild=${guildId} token=${hasToken ? "set" : "missing"}`,
	)

	// Sanity check D1 is wired. Milestone 2+ will replace this with real work.
	const { results } = await env.DB.prepare(
		"SELECT COUNT(*) AS n FROM messages",
	).all()
	const n = (results[0] as { n: number }).n
	console.log(`[cron] D1 reachable; messages=${n}; elapsed=${Date.now() - t0}ms`)
}
