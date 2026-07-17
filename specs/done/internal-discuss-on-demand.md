# `internal-discuss`: on-demand reads only, excluded from all archives

## Context

Ryan is granting the archive bot (**Marin Bot**, user id `1460618748787556484`) read access to the private `#internal-discuss` channel (id `1412294350645493840`) (so Claude sessions can read e.g. the weekly storage-report posts and cost/ops threads on demand). Policy: **that channel must never be persisted** — not in the DVX-tracked `archive/` JSON, `archive.db`, D1, or the deployed viewer. Only ad-hoc live reads via CLI.

Footgun this spec exists to close: archive scope is currently implicitly "everything the bot can see" (`archive.py` enumerates guild channels, skips only no-access). Granting the bot access without a landed exclusion means the next cron run (downstream repos → `actions/update-archive@v1` → `archive.py -g $DISCORD_GUILD`) persists the channel everywhere.

## Ordering (hard requirement)

1. Land the exclusion here, default-on in `archive.py` (not flag-only — downstream callers must inherit it with zero workflow changes).
2. Update/move whatever ref the downstream cron pins (`v1` tag for the composite actions) so the running cron actually has the exclusion.
3. Only then does Ryan grant the bot the channel permission (channel Permissions → "Add members or roles" → Marin Bot).

## Changes

### 1. `archive.py`: public channels only, by default

Rather than maintaining a per-private-channel exclusion list, the archiver derives each channel's visibility and **archives only public channels by default** — so future private channels need zero maintenance. "Private" is computed exactly as Discord's UI defines it: a `permission_overwrites` entry denying `VIEW_CHANNEL` (`1 << 10`) to `@everyone` (the role whose ID equals the guild ID). The guild channel-list endpoint returns overwrites for all channels, including ones the bot can't read, so this works without per-channel access.

- `is_public(ch, guild_id)` per above; private channels are skipped with a log line (`#…: private, skipping (pass -p <id> to include)`).
- Private *threads* (type 12) inside public channels are likewise skipped by default.
- `-p/--include-private <id>` (repeatable) is the escape hatch for a private channel/thread that *should* be archived.
- Belt-and-suspenders on top: module `excluded_channels.py` holds `EXCLUDED_CHANNEL_IDS` (`internal-discuss` = `1412294350645493840`) — a hard block that wins even over `-p`, with deliberately no disable flag. `-x/--exclude` / `DISCORD_EXCLUDE_CHANNELS` add to it ad hoc (e.g. to exclude a *public* channel).

### 2. `cli.py`: on-demand live read subcommands

Read-only, straight from the REST API via `discord_api.py`, token from `DISCORD_TOKEN` read inside the script. No writes outside stdout / `tmp/`.

- `channels` — list guild channels visible to the bot (id, name, type). Confirms access grants.
- `read <channel> [-a/--after <date|msg-id>] [-b/--before <…>] [-n/--limit N]` — print messages (timestamp, author, content, thread markers) to stdout; `<channel>` accepts ID or name.
- Optionally `search <channel> <pattern>` — client-side filter over paginated history (Discord's API has no server-side search for bots).

These are the AA surface for Claude sessions; keep output plain and pipeable.

### 3. `build_db.py`: belt-and-suspenders assert

Fail loudly if any `EXCLUDED_CHANNEL_IDS` member appears in the input `archive/` JSON (protects against a stale/patched fetch layer silently propagating private content to DB → D1 → viewer). Imports the same `excluded_channels.py` as `archive.py` — single source of truth, dependency-free so both uv-script headers stay unchanged.

### 4. CFW scheduled ingest: same filter (added during implementation)

The Worker cron (`api/src/scheduled.ts`, every 10 min in `marin-discord`) is a second ingest path that would otherwise pull any bot-visible channel into D1. It now applies the same policy: `isPublic` (`api/src/discord.ts`), private threads skipped, threads require a public parent, and `api/src/excluded_channels.ts` mirrors the Python blocklist (keep in sync).

Deploy note: the `marin-discord` crons pin `discord-agent@marin` (not `v1`) — the `marin` branch (branding on top of `main`) is the ref that must carry these changes, and the worker needs a `deploy-worker` dispatch to pick them up.

## Non-goals

- marinmirror / `mum` corpus coverage (Russell's ingest bot; separate decision).
- Any change to viewer/D1 filtering — exclusion at the fetch layer plus the build assert is the design; private content should never reach those layers.

## Verification (done 2026-07-17)

- `is_public` against the real guild channel list: 75 text channels → 71 public, 4 private (`internal-discuss`, `marin-bot-dbg`, `moderator-only`, `openthoughts-next-core`), all detected.
- `build_db.py` against a fixture containing an excluded-channel file → hard failure ("POLICY VIOLATION … refusing to build").
- `cli.py read general -n 3` live-read smoke test passed.
- Manual `update-archive` dispatch in `marin-discord` (run 29609597853) green on the new code; logs show `#internal-discuss: excluded by policy, skipping` + the 3 other private channels skipped as private.
- `deploy-worker` dispatch deployed the filtered CFW cron; `api` typecheck clean.
