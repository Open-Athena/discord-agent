# Spec: Viewer link navigation UX

## Problem

Discord messages frequently contain `https://discord.com/channels/G/C/M`
links pointing to other Discord messages (or `<#CHANNEL_ID>` channel
mentions).

Currently the viewer renders these as bare Discord URLs — clicking
pops out to Discord. Users who are reading the archive in the browser
often want to navigate internally without leaving the viewer.

## Desired behavior

When a message contains a link to another Discord message or channel
that exists in our archive:

1. **Default click**: navigate within the viewer (`#CHANNEL/MSG` hash nav).
2. **Modifier click** (⌘-click / middle-click / right-click → "Open in Discord"):
   open in Discord like normal.
3. **Hover**: show a small tooltip with both options:
   - "View in archive" (default click)
   - "Open in Discord ↗"

## Implementation

### Link detection

In the viewer's message-rendering pipeline, detect:
- `https://discord.com/channels/{guild_id}/{channel_id}/{message_id}` — message link
- `https://discord.com/channels/{guild_id}/{channel_id}` — channel link
- `<#CHANNEL_ID>` — channel mention (already handled elsewhere?)

For matches where the guild matches the archive's guild, route the
default click to the internal hash URL. For other guilds or unknown
IDs, leave as external link.

### Tooltip

Use a small floating tooltip (floating-ui or similar) on hover showing
both options with icons. Keyboard-accessible. Fades out on mouse leave.

### Fallback

If the referenced message isn't in the archive (e.g. too new,
deleted, or from another guild), only show "Open in Discord ↗" and
default-click routes externally.

## Channel mentions (`<#ID>`)

These are already rendered as clickable pills in the viewer (I think?).
Apply the same treatment: default-click goes to viewer, tooltip offers
Discord.

## Viewer config

The archive's `guild_id` should be available client-side (via the
Worker's `/api/meta` endpoint or a baked-in config var). Used to
distinguish "our" Discord links from cross-guild ones.
