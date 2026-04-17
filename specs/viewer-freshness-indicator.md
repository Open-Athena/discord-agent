# Spec: Viewer freshness indicator + data-source links

## Goal

Surface in the viewer UI how up-to-date the underlying data is, and give
users links to both the live data source (D1 API) and the bulk archive
(`archive.db` on S3). Users should tell at a glance whether they're
looking at near-real-time or overnight-stale data.

## Worker endpoint

`GET /api/meta`:
```json
{
  "latest_message_ts": "2026-04-17T03:45:12Z",
  "total_messages": 26401,
  "total_channels": 68,
  "total_users": 933,
  "guild_id": "1354881461060243556",
  "archive_db_url": "https://openathena.s3.amazonaws.com/marin-discord/archive.db"
}
```

- `latest_message_ts` = `MAX(timestamp) FROM messages` in D1
- `guild_id` from Worker env var (`GUILD_ID` in `wrangler.toml` `[vars]`)
- `archive_db_url` from Worker env var (optional — falls back to omit)

## UI

Small footer in the sidebar (below the channel list) showing:

```
Updated 4m ago · 26,401 msgs
```

On hover (tooltip) or click (mobile), expand to show:
- Latest message: absolute timestamp + relative ago
- Counts per surface (messages, channels, users)
- Links:
  - **D1 API** — the `/api/*` base URL (live, same as what the viewer reads)
  - **Bulk archive (`archive.db`)** — S3 URL, updated daily, SQLite file for cowo download

Style: subtle muted text. Not intrusive.

## Non-goals

- Separate freshness numbers for D1 vs S3 (overkill for v1; the footer
  speaks for D1; the S3 link is labeled "daily").
- Auto-refresh the freshness indicator (recomputes on query
  invalidation — fine for a slow-moving archive).
