# Spec: Track pipeline last-sync time + link to GHA run

## Problem

The viewer's footer shows "Latest msg Nh ago" derived from
`MAX(timestamp) FROM messages`. That's "newest message in the
archive", not "when did the pipeline last run". Those can differ
widely:

- Sync ran 5m ago, found 0 new messages → footer says "Latest msg 6h
  ago" (conflating quiet channels with broken sync).
- Sync broken for 2 days → footer still says whatever the latest
  message timestamp is, with no signal that writes have stopped.

Users can't tell which case they're in.

## Goal

Surface explicit "last sync" freshness separate from "latest msg".
When run by GHA, link to the run that did it.

## Storage

Add a `sync_runs` table in D1 + the source SQLite:

```sql
CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,       -- e.g. "gha:24568841174" or "cfw:2026-04-17T12:34:00Z"
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  source TEXT NOT NULL,      -- 'gha' | 'cfw'
  run_url TEXT,              -- e.g. GHA run URL (nullable for CFW)
  messages_added INTEGER,    -- optional stat
  status TEXT NOT NULL       -- 'ok' | 'error'
);
```

## Writers

1. `d1-sync.py` (GHA path): inserts a row at end of run.
   - `id = "gha:$GITHUB_RUN_ID"` (or `cli:<timestamp>` if run locally)
   - `run_url = "https://github.com/Open-Athena/marin-discord/actions/runs/$GITHUB_RUN_ID"`
   - `source = "gha"`
   - GHA `update-archive.yml` passes `GITHUB_RUN_ID` as an env var to
     `d1-sync.py`.
2. CFW incremental updater (future): inserts at end of each /10min run.
   - `id = "cfw:<ISO timestamp>"`
   - `source = "cfw"`
   - `run_url = null` (no per-run URL for CFW)

## Reader

Extend `/api/meta`:

```json
{
  "latest_message_ts": "...",
  "latest_sync": {
    "finished_at": "2026-04-17T08:06:42Z",
    "source": "gha",
    "run_url": "https://github.com/Open-Athena/marin-discord/actions/runs/...",
    "messages_added": 142,
    "status": "ok"
  },
  ...
}
```

## UI

Footer text: prefer the sync freshness over the message freshness.

- `Synced Nm ago · 25,779 msgs`
- Tooltip keeps both, labeled clearly:
  - "Latest sync: 4m ago (GHA run #123, +142 msgs)"
  - "Latest message: 6h ago" (separate line, de-emphasized)

If the most recent sync failed, visually indicate (red dot, "Sync
failed Nh ago").

## Non-goals

- Don't surface the full sync history UI. Just the latest successful
  row + optionally latest-of-any-status.
- No retention policy for `sync_runs` in v1 — table is small.
