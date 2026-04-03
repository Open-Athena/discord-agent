# Spec: `discord-agent` CLI

## Goal

Consolidate the growing collection of standalone scripts (`archive.py`, `build_db.py`, `summarize.py`, `server.py`, etc.) under a single CLI entry point with subcommands. Add `post`/`edit`/`delete` subcommands for Discord message management, so callers (humans, GHA workflows, other scripts) don't need to hand-roll `curl` calls.

## Entry point

A new `cli.py` (or rename to `discord_agent.py`) using Click groups:

```bash
./cli.py archive ...        # wraps archive.py
./cli.py build-db ...       # wraps build_db.py
./cli.py summarize ...      # wraps summarize.py (generation only)
./cli.py serve ...          # wraps server.py
./cli.py post ...           # new: post message to Discord
./cli.py edit ...           # new: edit a bot message
./cli.py delete ...         # new: delete bot message(s)
```

Each existing script should remain independently runnable (`uv run` shebang) for backwards compat, but the CLI provides a unified interface.

## Environment / config

Many flags are repeated across subcommands (`--db-path`, `--guild-id`, `--viewer-base`, `--discord-token`, etc.). These should resolve from (in priority order):

1. CLI flag
2. Environment variable (e.g. `DISCORD_TOKEN`, `DISCORD_GUILD`, `VIEWER_BASE`, `ARCHIVE_DB`)
3. `.discord-agent.json` project config (optional, checked in cwd and parents)

The config file would look like:
```json
{
  "guild_id": "1354881461060243556",
  "viewer_base": "https://marin-discord.pages.dev",
  "db_path": "archive.db",
  "post_channel": "1489279547689140505"
}
```

This way the common case for marin-discord is just:
```bash
./cli.py summarize --week 2026-03-24 --post-discord
```

## New subcommands

### `post`

Post a message to a Discord channel.

```bash
./cli.py post CHANNEL_ID "message text"
./cli.py post CHANNEL_ID --file summary.md
./cli.py post CHANNEL_ID "text" --suppress-embeds
./cli.py post CHANNEL_ID "text" --thread-name "Thread Title"  # creates thread
./cli.py post THREAD_ID "reply text"                          # reply in thread
```

- Uses `curl` subprocess (not `urllib`) due to Cloudflare blocking Python user-agents on Discord API.
- Handles chunking for messages >2000 chars.
- Prints message ID(s) to stdout for scripting.

### `edit`

Edit an existing bot message.

```bash
./cli.py edit CHANNEL_ID MESSAGE_ID "new content"
./cli.py edit CHANNEL_ID MESSAGE_ID --file updated.md
```

### `delete`

Delete bot message(s).

```bash
./cli.py delete CHANNEL_ID MESSAGE_ID [MESSAGE_ID ...]
./cli.py delete CHANNEL_ID --bot-only --limit 50   # delete all bot messages in channel
./cli.py delete CHANNEL_ID --after MESSAGE_ID       # delete all bot messages after a given message
```

Safety: only delete messages authored by the bot. Refuse to delete other users' messages.

## `summarize` updates

The `summarize` subcommand already generates XS/S/M tiers and posts to Discord. The posting logic should move to use the `post` subcommand internally (or share the same `discord_post` / `discord_create_thread` helpers).

Key behavior to preserve:
- XS as main channel message with `# Weekly Digest: {date range}` h1
- Thread created from XS message
- S posted as first thread reply
- M chunked and posted as subsequent thread replies
- All messages posted with `suppress_embeds=True`
- Channel mention format `<#ID>` in h2 headers (rendered as clickable pills)

## Shared helpers

Extract into a `discord_api.py` module (or similar):
- `discord_request(method, path, **kwargs)` — wraps curl calls, handles auth, rate limiting
- `discord_post(channel_id, content, ...)` — post message
- `discord_edit(channel_id, message_id, content)` — edit message
- `discord_delete(channel_id, message_id)` — delete message
- `discord_create_thread(channel_id, message_id, name)` — create thread
- `discord_list_messages(channel_id, limit, ...)` — list messages
- `chunk_message(text, limit=1900)` — split text for Discord's 2000 char limit

## Non-goals

- Slack posting: leave as-is for now (needs mrkdwn conversion, separate effort)
- Bot framework / event handling: this is a CLI tool, not a long-running bot
- User mention injection: future work, needs opt-in to avoid pinging during iteration
