# Spec: Archive viewer ↔ Discord deep linking

## Context

The archive viewer at `marin-discord.pages.dev` shows messages with `#channel/message` hash URLs. Currently, summaries posted to Discord use `discord.com/channels/...` links (good for in-Discord reading), and the viewer has no easy way to jump into the live Discord conversation.

## Goals

1. **Viewer → Discord**: Each message in the archive viewer should have a link/button to open that message in Discord
2. **Configurable link targets**: Summaries should be able to target either the viewer or Discord depending on where they're posted

## Viewer → Discord

Add a small Discord icon/link next to each message in the viewer that opens `https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID`. The guild ID can be:
- Passed as a query param: `?guild=1354881461060243556`
- Set in the viewer's config/env
- Stored in the archive data (it's already in the DB)

This makes the viewer a useful companion to Discord rather than a standalone silo — you can browse the archive, find a conversation, and jump into Discord to continue it.

## Configurable link targets in summaries

The `summarize.py` LLM prompt provides both `[viewer]` and `[discord]` links for each message. Currently:
- Discord posting: converts viewer→discord links via `viewer_to_discord_links()`
- Slack posting: uses whatever the LLM chose (mixed)
- File output: uses whatever the LLM chose (mixed)

Instead, the summary output should always use viewer links as the canonical format (since they're shorter and platform-neutral), and each posting target converts as needed:
- **Discord**: viewer → `discord.com/channels/...` (current behavior)
- **Slack**: viewer links are fine (opens in browser, shows the archive)
- **File/git**: viewer links (canonical)

This means the `.md` files in `summaries/` always have viewer URLs, and conversion happens at post time.

## Implementation

### Viewer changes (app/)
- Add `DISCORD_GUILD_ID` to viewer config (env var or `wrangler.toml` var)
- For each message, render a small "Open in Discord" link/icon
- URL format: `https://discord.com/channels/{guild}/{channel}/{message}`

### summarize.py changes
- Instruct LLM to always use viewer links in output
- `viewer_to_discord_links()` already exists for Discord posting
- For Slack: leave viewer links as-is (or convert to Discord links if preferred — make configurable)
- Add `--link-target` flag: `viewer` (default) | `discord` to control file output

## Non-goals
- Bidirectional sync (Discord→viewer message editing)
- Viewer as a Discord client (no posting/replying from viewer)
