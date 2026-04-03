#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["click"]
# ///
"""discord-agent CLI — archive, search, summarize, and manage Discord servers.

Usage:
    ./cli.py archive ...
    ./cli.py build-db ...
    ./cli.py summarize ...
    ./cli.py serve ...
    ./cli.py post CHANNEL_ID "message"
    ./cli.py edit CHANNEL_ID MESSAGE_ID "new content"
    ./cli.py delete CHANNEL_ID MESSAGE_ID [MESSAGE_ID ...]
"""

import json
import os
import sys
from functools import partial
from pathlib import Path

import click

err = partial(print, file=sys.stderr)

# Resolve config from .discord-agent.json (cwd and parents)
_config: dict | None = None

def _load_config() -> dict:
    global _config
    if _config is not None:
        return _config
    p = Path.cwd()
    while p != p.parent:
        cfg = p / ".discord-agent.json"
        if cfg.exists():
            _config = json.loads(cfg.read_text())
            return _config
        p = p.parent
    _config = {}
    return _config


def _resolve(cli_val: str | None, env_key: str, config_key: str, default: str = "") -> str:
    """Resolve a value from CLI flag > env var > config file > default."""
    if cli_val:
        return cli_val
    val = os.environ.get(env_key)
    if val:
        return val
    cfg = _load_config()
    return cfg.get(config_key, default)


@click.group()
def cli():
    """discord-agent — archive, search, summarize, and manage Discord servers."""


# ── archive ──────────────────────────────────────────────────────────────────

@cli.command()
@click.pass_context
@click.option('-A', '--no-attachments', is_flag=True, help='Skip downloading attachments')
@click.option('-b', '--backfill-attachments', is_flag=True, help='Download all missing attachments')
@click.option('-g', '--guild', default=None, help='Guild ID (or DISCORD_GUILD env var)')
@click.option('-o', '--out-dir', default=None, help='Output directory')
@click.option('-T', '--no-threads', is_flag=True, help='Skip thread messages')
def archive(ctx, guild, no_attachments, backfill_attachments, no_threads, out_dir):
    """Archive all messages from a Discord guild."""
    import asyncio
    # Import the archive module's run function
    sys.path.insert(0, str(Path(__file__).parent))
    from archive import run

    guild = _resolve(guild, "DISCORD_GUILD", "guild_id")
    out_dir = _resolve(out_dir, "ARCHIVE_DIR", "archive_dir", "archive")
    if not guild:
        raise click.ClickException("Guild ID required: --guild, DISCORD_GUILD, or .discord-agent.json")
    asyncio.run(run(guild, out_dir, not no_attachments, not no_threads, backfill_attachments))


# ── build-db ─────────────────────────────────────────────────────────────────

@cli.command("build-db")
@click.option('-i', '--input-dir', default=None, help='Archive directory')
@click.option('-o', '--output', default=None, help='Output database path')
def build_db(input_dir, output):
    """Build SQLite database from archived JSON files."""
    sys.path.insert(0, str(Path(__file__).parent))
    from build_db import build_db as _build_db

    input_dir = _resolve(input_dir, "ARCHIVE_DIR", "archive_dir", "archive")
    output = _resolve(output, "ARCHIVE_DB", "db_path", "archive.db")
    _build_db(input_dir, output)


# ── summarize ────────────────────────────────────────────────────────────────

@cli.command()
@click.pass_context
@click.option('-d', '--db-path', default=None, help='Path to archive.db')
@click.option('-g', '--guild-id', default=None, help='Guild ID (for Discord permalinks)')
@click.option('-n', '--dry-run', is_flag=True, help='Print raw data, skip LLM')
@click.option('-o', '--output', default='-', help='Output file (default: stdout)')
@click.option('-v', '--viewer-base', default=None, help='Viewer base URL')
@click.option('-w', '--week', default=None, help='Week start (Monday), YYYY-MM-DD')
@click.option('--post-discord', is_flag=True, help='Post to configured Discord channel')
@click.option('--post-channel', default=None, help='Discord channel ID to post to')
def summarize(ctx, db_path, guild_id, dry_run, output, viewer_base, week, post_discord, post_channel):
    """Generate a weekly Discord activity summary."""
    sys.path.insert(0, str(Path(__file__).parent))
    from summarize import get_week_range, query_week_data, format_stats, format_channel_data, generate_summary

    db_path = _resolve(db_path, "ARCHIVE_DB", "db_path", "archive.db")
    guild_id = _resolve(guild_id, "DISCORD_GUILD", "guild_id")
    viewer_base = _resolve(viewer_base, "VIEWER_BASE", "viewer_base")

    # Set globals in summarize module
    import summarize as sm
    if viewer_base:
        sm.VIEWER_BASE = viewer_base
    if guild_id:
        sm.DISCORD_GUILD_ID = guild_id

    start, end = get_week_range(week)
    err(f"Summarizing week of {start} to {end}")

    data = query_week_data(db_path, start, end)
    if data["total_msgs"] == 0:
        err("No messages found for this week")
        return

    err(f"Found {data['total_msgs']} messages across {data['total_channels']} channels")

    if dry_run:
        stats = format_stats(data)
        channel_data = format_channel_data(data)
        print(f"# Week of {start} to {end}\n\n{stats}\n\n{channel_data}")
        return

    summary = generate_summary(data, start, end)

    if output == '-':
        print(summary)
    else:
        Path(output).write_text(summary + "\n")
        err(f"Wrote summary to {output}")

    # Post to Discord
    channel = post_channel or _resolve(None, "", "post_channel")
    if post_discord and channel:
        from discord_api import chunk_message, discord_post
        chunks = chunk_message(summary)
        for i, c in enumerate(chunks):
            msg_id = discord_post(channel, c, suppress_embeds=True)
            if msg_id:
                err(f"Posted chunk {i+1}/{len(chunks)} (id: {msg_id})")
            else:
                err(f"Failed to post chunk {i+1}")


# ── serve ────────────────────────────────────────────────────────────────────

@cli.command()
@click.option('-d', '--db-path', default=None, help='Path to archive.db')
@click.option('-p', '--port', default=5273, type=int, help='Port')
def serve(db_path, port):
    """Start the local API server."""
    db_path = _resolve(db_path, "ARCHIVE_DB", "db_path", "archive.db")
    os.environ["ARCHIVE_DB"] = db_path
    sys.path.insert(0, str(Path(__file__).parent))
    import uvicorn
    from server import app
    err(f"Serving {db_path} on http://localhost:{port}/api/")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


# ── post ─────────────────────────────────────────────────────────────────────

@cli.command()
@click.argument("channel_id")
@click.argument("content", required=False)
@click.option('-f', '--file', 'file_path', default=None, help='Read content from file')
@click.option('-S', '--suppress-embeds', is_flag=True, help='Suppress link embeds')
@click.option('-t', '--thread-name', default=None, help='Create a thread with this name')
def post(channel_id, content, file_path, suppress_embeds, thread_name):
    """Post a message to a Discord channel."""
    from discord_api import chunk_message, discord_create_thread, discord_post

    if file_path:
        content = Path(file_path).read_text()
    if not content:
        raise click.ClickException("Provide content as argument or --file")

    chunks = chunk_message(content)
    msg_ids = []
    for i, c in enumerate(chunks):
        msg_id = discord_post(channel_id, c, suppress_embeds=suppress_embeds)
        if msg_id:
            msg_ids.append(msg_id)
            err(f"Posted chunk {i+1}/{len(chunks)} (id: {msg_id})")
        else:
            err(f"Failed to post chunk {i+1}")
            raise SystemExit(1)

    if thread_name and msg_ids:
        thread_id = discord_create_thread(channel_id, msg_ids[0], thread_name)
        if thread_id:
            err(f"Created thread: {thread_id}")
            print(thread_id)
        else:
            err("Failed to create thread")
    else:
        # Print message IDs to stdout for scripting
        for mid in msg_ids:
            print(mid)


# ── edit ─────────────────────────────────────────────────────────────────────

@cli.command()
@click.argument("channel_id")
@click.argument("message_id")
@click.argument("content", required=False)
@click.option('-f', '--file', 'file_path', default=None, help='Read content from file')
def edit(channel_id, message_id, content, file_path):
    """Edit a bot message."""
    from discord_api import discord_edit

    if file_path:
        content = Path(file_path).read_text()
    if not content:
        raise click.ClickException("Provide content as argument or --file")

    if discord_edit(channel_id, message_id, content):
        err(f"Edited message {message_id}")
    else:
        err(f"Failed to edit message {message_id}")
        raise SystemExit(1)


# ── delete ───────────────────────────────────────────────────────────────────

@cli.command()
@click.argument("channel_id")
@click.argument("message_ids", nargs=-1, required=False)
@click.option('-B', '--bot-only', is_flag=True, help='Delete all bot messages in channel')
@click.option('-l', '--limit', default=50, type=int, help='Max messages to scan (with --bot-only)')
@click.option('--after', default=None, help='Delete bot messages after this message ID')
def delete(channel_id, message_ids, bot_only, limit, after):
    """Delete bot message(s). Only deletes messages authored by the bot."""
    from discord_api import discord_delete, discord_list_messages, discord_request

    if bot_only or after:
        # Get bot user ID
        me = discord_request("GET", "/users/@me")
        if not me or "id" not in me:
            raise click.ClickException("Failed to get bot user info")
        bot_id = me["id"]

        messages = discord_list_messages(channel_id, limit=limit)
        to_delete = []
        for msg in messages:
            if msg.get("author", {}).get("id") != bot_id:
                continue
            if after and int(msg["id"]) <= int(after):
                continue
            to_delete.append(msg["id"])

        if not to_delete:
            err("No bot messages to delete")
            return

        err(f"Deleting {len(to_delete)} bot messages...")
        for mid in to_delete:
            if discord_delete(channel_id, mid):
                err(f"  deleted {mid}")
    elif message_ids:
        for mid in message_ids:
            if discord_delete(channel_id, mid):
                err(f"Deleted {mid}")
            else:
                err(f"Failed to delete {mid}")
    else:
        raise click.ClickException("Provide message IDs or --bot-only")


if __name__ == "__main__":
    cli()
