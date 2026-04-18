# Spec: Cloudflare Worker for ~10min D1 incremental updates

## Goal

A Cloudflare Worker with a cron trigger that keeps the D1 database near-real-time by fetching new Discord messages every ~10 minutes, without doing the full archive pipeline (no JSON files, no S3, no archive.db rebuild).

The daily GHA `update-archive` workflow remains the source of truth — it refreshes JSON archives on S3 and the `archive.db` mirror. This CFW is a faster-refresh layer on top of D1.

## Architecture

```
Daily GHA (8am UTC)              CFW cron (every 10 min)
  ├─ archive.py → JSON            ├─ Query D1 for latest msg ts per channel
  ├─ build_db.py → archive.db     ├─ Fetch new msgs from Discord API
  ├─ dvx push → S3                ├─ Insert into D1
  ├─ d1-sync.py → D1              └─ (skip: no S3, no SQLite build)
  └─ s3 cp archive.db → S3
```

Discord → D1 paths:
- **Daily, authoritative**: Discord → JSON → SQLite → D1
- **Fast, incremental**: Discord → D1 (CFW)

If they conflict (unlikely), the daily run wins.

## Worker structure

`api/src/cron.ts` (or similar):

```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // 1. Query D1 for latest message ts per channel
    const latestByChannel = await env.DB.prepare(`
      SELECT channel_id, MAX(timestamp) as latest
      FROM messages
      GROUP BY channel_id
    `).all()

    // 2. Fetch channel list from Discord
    const channels = await discordFetch(
      `/guilds/${env.GUILD_ID}/channels`,
      env.DISCORD_TOKEN,
    )

    // 3. For each text channel, fetch messages after `latest`
    for (const channel of channels.filter(c => c.type === 0)) {
      const after = latestByChannel.find(r => r.channel_id === channel.id)?.latest
      const newMessages = await fetchMessagesAfter(channel.id, after, env.DISCORD_TOKEN)

      // 4. Bulk insert into D1
      if (newMessages.length > 0) {
        await insertMessages(env.DB, newMessages)
      }
    }
  }
}
```

`wrangler.toml`:
```toml
[triggers]
crons = ["*/10 * * * *"]  # every 10 min

[vars]
GUILD_ID = "..."

# DISCORD_TOKEN as a secret
```

## Challenges

### 1. Discord API rate limits

Fetching all channels every 10 min is fine as long as we only pull new messages. Worker has plenty of request budget. Need to respect Discord's rate limits (50 req/s global, per-route limits).

### 2. Worker CPU limits

- Free plan: 10ms CPU per request (won't work for this)
- Paid plan: 30s CPU per request (fine)
- Wall-clock is different from CPU

### 3. Schema coverage

`messages`, `users`, `attachments`, `reactions`, `embeds`, `threads` — all need insert logic. Currently `d1-import.sh` uses SQLite→SQL dump→D1. The CFW would need bespoke insert logic per table.

### 4. Threads

Archive.py recurses into threads (message type 21 creates a thread). The CFW would need similar thread-traversal logic.

### 5. User/channel dedup

New users/channels must be upserted (INSERT OR REPLACE or ON CONFLICT DO UPDATE).

## Decision (updated)

**Build the CFW**, running every 10 min. Benefits:
- D1 stays near-real-time (≤10min freshness)
- Viewer (which reads D1) becomes live
- Enables near-real-time summarization triggers
- Reliable cron (CF runs ±seconds, vs GHA's 15-60min delays)

S3 `archive.db` mirror remains daily (GHA). It's a bulk-DL surface for
coworkers; its SLA can be worse than D1's.

Trade-off accepted: rewriting `archive.py`'s incremental fetch in TS
is a one-time cost; we're keeping the Python daily GHA for authoritative
full-pipeline work (dvx push, rebuild, etc.).

## Layered architecture

```
Daily GHA (8am UTC) — authoritative            CFW (every 10 min) — live
  ├─ archive.py → JSON (incr fetch)              ├─ Query D1 for latest ts per channel
  ├─ build_db.py → archive.db                    ├─ Fetch new msgs from Discord API
  ├─ dvx push → S3 (JSONs)                       ├─ Upsert into D1
  ├─ d1-sync.py → D1                             └─ (skip: no S3, no git, no JSONs)
  ├─ archive.db → S3 (bulk mirror)
  └─ commit archive.dvc
```

## Alternative considered: more frequent GHA

GHA scheduled jobs can run every 5 min, but:
- GitHub delays scheduled jobs during peak times (often by 15-60 min)
- Each run is 3+ min wall clock, so running every 5 min is wasteful
- ~288 runs/day × 3 min ≈ 14.4 hrs of runner time / day

CFW is the right tool.
