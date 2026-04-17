# Spec: Viewer default channel on load

## Problem

Viewer first-load (no hash fragment) shows a blank "Select a channel to
view messages" pane. Users land on an empty page and have to pick
something. Poor first impression, and users may not realize there's
content until they click into a channel.

## Desired behavior

When the URL has no hash (`#CHANNEL_ID/...`), auto-select a default
channel so content is visible immediately.

**Resolution order**:
1. `VITE_DEFAULT_CHANNEL` build-time env var (name or ID) — if set and
   the channel exists, use it.
2. Channel named `general` (if present).
3. Most-recently-active channel (max `newest` timestamp) of the visible
   text channels.
4. First channel in the sorted list (fallback).

## Implementation

`App.tsx`: in the `navigateToHash` effect, if no `channelId` and
channels have loaded, resolve the default per the order above and call
`setActiveChannel()`. Do **not** set `window.location.hash` — leave the
URL at `/` so users can still "reset to default" by visiting the bare
domain; only update the hash when the user explicitly navigates.

Wait, actually — setting the hash makes back/forward work naturally,
and leaves a clear bookmark. Setting it is probably right. Either way,
document the choice.

Decision: **set the hash**. Reloading `/` should still end up at the
default. (First render: hash is empty → resolve default → set hash →
handler no-ops because channel is already active.)

## Non-goals

- Remembering the user's last-viewed channel in `localStorage`.
  Possible follow-up, but not for v1 — deterministic default is a
  cleaner baseline.
