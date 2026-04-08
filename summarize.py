#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "click",
#     "thrds>=0.2.0",
# ]
# ///
"""Generate weekly Discord activity summaries in XS/S/M tiers.

Queries the archive database for a given week's activity, then calls
Claude to generate structured summaries at three levels of detail:
  XS: 1-2 sentence headline with key stats
  S:  ~5 bullet points, one per major workstream
  M:  Full sectioned summary with channel headers and discussion

Usage:
    ./summarize.py                           # current week (Mon-Sun)
    ./summarize.py --week 2026-03-17         # specific week (starting Monday)
    ./summarize.py --dry-run                 # print raw data, skip LLM call
    ./summarize.py --post-discord CHANNEL_ID # post XS + thread with S/M
    ./summarize.py --post-slack CHANNEL_ID   # post summary to Slack
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from click import command, option

err = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

DB_PATH = os.environ.get("ARCHIVE_DB", "archive.db")
VIEWER_BASE = os.environ.get("VIEWER_BASE", "")
DISCORD_GUILD_ID = os.environ.get("DISCORD_GUILD", "")

SYSTEM_PROMPT = """\
You are a technical writer summarizing weekly Discord activity for a research \
engineering team. Produce three tiers of summary, returned as JSON.

Output format — return ONLY valid JSON with these keys:
{{
  "xs": "1-2 sentence headline with key stats (under 280 chars)",
  "s": "One bullet per M section (markdown list) — see S guidelines below",
  "m": "Full multi-section summary (markdown) — see M guidelines below"
}}

CRITICAL: The S tier must have exactly one bullet for each ## section in M, \
in the same order. No more, no fewer.

Style guidelines for all tiers:
- Tag key people by their Discord display name
- Casual but informative tone
- Lead with the most active/important topics
- Skip channels with only bot messages or trivial activity

Additional guidelines for the S (bullet) tier:
- One bullet per ## section in M, in the same order
- Each bullet is one concise line: **Topic** — single sentence summary
- Keep each bullet under 120 chars (excluding the bold topic name)
- No inline links needed (they will be added programmatically)

Additional guidelines for the M (full) tier:
- Use ## headers for each workstream/topic section
- For section headers referencing a Discord channel, use the Discord channel \
mention format: ## <#CHANNEL_ID> — Section Title. The channel ID mapping is \
provided below.
- 1-3 sentences per topic, focusing on decisions and progress
- Include links to GitHub PRs/issues when mentioned
- Reference specific messages using the [viewer] and [discord] links provided
- When citing a key discussion point, include a link to the originating message
- Wrap bare URLs in angle brackets to suppress embeds: <https://example.com>
- For arxiv and other paper links, use the paper title as anchor text: \
[Paper Title](https://arxiv.org/abs/...) — never leave arxiv URLs bare
- End with a "News & Research" section for shared papers/links if any

{channel_id_map}"""

SUMMARY_PROMPT = """\
Generate a weekly summary of this Discord activity for the week of {week_start} to {week_end}.

## Stats
{stats}

## Messages by channel (most active first)
{channel_data}"""


def get_week_range(week_start: str | None) -> tuple[str, str]:
    """Get Monday-Sunday date range for a week."""
    if week_start:
        dt = datetime.strptime(week_start, "%Y-%m-%d")
    else:
        dt = datetime.now()
        dt -= timedelta(days=dt.weekday())
    monday = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    sunday = monday + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return monday.strftime("%Y-%m-%d"), sunday.strftime("%Y-%m-%d")


def query_week_data(db_path: str, start: str, end: str) -> dict:
    """Query all activity for a given week from the archive database."""
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    channels = db.execute("""
        SELECT c.name, c.id, COUNT(m.id) as msg_count,
               COUNT(DISTINCT m.author_id) as unique_authors
        FROM messages m
        JOIN channels c ON m.channel_id = c.id
        WHERE m.timestamp >= ? AND m.timestamp < ?
          AND c.type != 11
        GROUP BY c.id
        ORDER BY msg_count DESC
    """, (start, end + "T23:59:59")).fetchall()

    users = db.execute("""
        SELECT u.global_name, u.username, u.id, COUNT(m.id) as msg_count
        FROM messages m
        JOIN users u ON m.author_id = u.id
        WHERE m.timestamp >= ? AND m.timestamp < ?
        GROUP BY m.author_id
        ORDER BY msg_count DESC
        LIMIT 15
    """, (start, end + "T23:59:59")).fetchall()

    total_msgs = sum(ch["msg_count"] for ch in channels)
    total_channels = len(channels)
    total_users = len(set(
        r["global_name"] or r["username"] for r in users
    ))

    channel_data = {}
    for ch in channels[:20]:
        msgs = db.execute("""
            SELECT m.content, m.timestamp, m.type,
                   u.global_name, u.username,
                   m.id, m.channel_id
            FROM messages m
            LEFT JOIN users u ON m.author_id = u.id
            WHERE m.channel_id = ? AND m.timestamp >= ? AND m.timestamp < ?
            ORDER BY m.timestamp
        """, (ch["id"], start, end + "T23:59:59")).fetchall()

        channel_msgs = []
        for msg in msgs:
            content = msg["content"] or ""
            for match in re.finditer(r'<#(\d+)>', content):
                ch_row = db.execute("SELECT name FROM channels WHERE id = ?", (match.group(1),)).fetchone()
                if ch_row:
                    content = content.replace(match.group(0), f"#{ch_row['name']}")
            for match in re.finditer(r'<@!?(\d+)>', content):
                u_row = db.execute("SELECT global_name, username FROM users WHERE id = ?", (match.group(1),)).fetchone()
                if u_row:
                    name = u_row["global_name"] or u_row["username"]
                    content = content.replace(match.group(0), f"@{name}")

            author = msg["global_name"] or msg["username"] or "Unknown"
            msg_id = msg["id"]
            ch_id = msg["channel_id"]
            links = []
            if VIEWER_BASE:
                links.append(f"[viewer]({VIEWER_BASE}/#{ch_id}/{msg_id})")
            if DISCORD_GUILD_ID:
                links.append(f"[discord](https://discord.com/channels/{DISCORD_GUILD_ID}/{ch_id}/{msg_id})")
            link_str = " ".join(links)
            channel_msgs.append({
                "author": author,
                "content": content,
                "timestamp": msg["timestamp"],
                "link": link_str,
                "msg_id": msg_id,
                "channel_id": ch_id,
            })
        channel_data[ch["name"]] = {
            "id": ch["id"],
            "msg_count": ch["msg_count"],
            "unique_authors": ch["unique_authors"],
            "messages": channel_msgs,
        }

    reacted = db.execute("""
        SELECT m.content, m.timestamp, u.global_name, u.username,
               c.name as channel_name, SUM(r.count) as total_reactions
        FROM reactions r
        JOIN messages m ON r.message_id = m.id
        JOIN users u ON m.author_id = u.id
        JOIN channels c ON m.channel_id = c.id
        WHERE m.timestamp >= ? AND m.timestamp < ?
        GROUP BY m.id
        ORDER BY total_reactions DESC
        LIMIT 10
    """, (start, end + "T23:59:59")).fetchall()

    db.close()

    return {
        "total_msgs": total_msgs,
        "total_channels": total_channels,
        "total_users": total_users,
        "channels": [dict(ch) for ch in channels],
        "users": [dict(u) for u in users],
        "channel_data": channel_data,
        "most_reacted": [dict(r) for r in reacted],
    }


def format_channel_id_map(data: dict) -> str:
    """Format channel name → ID mapping for the LLM prompt."""
    lines = ["Channel ID mapping (use <#ID> for Discord channel mentions):"]
    for name, info in data["channel_data"].items():
        lines.append(f"  #{name} → <#{info['id']}>")
    return "\n".join(lines)


def format_stats(data: dict) -> str:
    """Format stats section for the prompt."""
    lines = [
        f"- {data['total_msgs']} messages across {data['total_channels']} channels",
        f"- {data['total_users']} active contributors",
        "",
        "Top channels: " + ", ".join(
            f"#{ch['name']} ({ch['msg_count']})" for ch in data["channels"][:10]
        ),
        "",
        "Most active: " + ", ".join(
            f"{u['global_name'] or u['username']} ({u['msg_count']})" for u in data["users"][:10]
        ),
    ]
    if data["most_reacted"]:
        lines.append("")
        lines.append("Most reacted messages:")
        for r in data["most_reacted"][:5]:
            author = r["global_name"] or r["username"]
            snippet = (r["content"] or "")[:80]
            lines.append(f"  - {author} in #{r['channel_name']}: \"{snippet}...\" ({r['total_reactions']} reactions)")
    return "\n".join(lines)


def format_channel_data(data: dict) -> str:
    """Format channel messages for the prompt."""
    parts = []
    for name, info in data["channel_data"].items():
        parts.append(f"### #{name} (id={info['id']}, {info['msg_count']} messages, {info['unique_authors']} authors)")
        for msg in info["messages"]:
            ts = msg["timestamp"][:16].replace("T", " ")
            content = msg["content"][:500] if msg["content"] else "(empty)"
            link = f" {msg['link']}" if msg.get("link") else ""
            parts.append(f"[{ts}] {msg['author']}: {content}{link}")
        parts.append("")
    return "\n".join(parts)


def generate_summary(data: dict, week_start: str, week_end: str) -> dict:
    """Call `claude` CLI to generate tiered summaries. Returns dict with xs, s, m keys."""
    stats = format_stats(data)
    channel_data = format_channel_data(data)
    channel_id_map = format_channel_id_map(data)

    system = SYSTEM_PROMPT.format(channel_id_map=channel_id_map)
    user_prompt = SUMMARY_PROMPT.format(
        week_start=week_start,
        week_end=week_end,
        stats=stats,
        channel_data=channel_data,
    )
    prompt = system + "\n\n" + user_prompt

    err(f"Sending {len(prompt)} chars to claude CLI...")

    result = subprocess.run(
        ["claude", "-p", "--output-format", "text"],
        input=prompt,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        err(f"claude CLI failed: {result.stderr}")
        raise RuntimeError(f"claude CLI exited with {result.returncode}")

    raw = result.stdout.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r'^```(?:json)?\s*\n?', '', raw)
        raw = re.sub(r'\n?```\s*$', '', raw)

    return json.loads(raw)


def discord_post(channel_id: str, content: str, thread_id: str | None = None, suppress_embeds: bool = False) -> dict:
    """Post a message to Discord via curl (urllib gets blocked by Cloudflare)."""
    token = os.environ["DISCORD_TOKEN"]
    payload = {"content": content}
    if thread_id:
        payload["message_reference"] = {"message_id": thread_id}
    if suppress_embeds:
        payload["flags"] = 4  # SUPPRESS_EMBEDS

    result = subprocess.run(
        [
            "curl", "-s",
            "-X", "POST",
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            "-H", f"Authorization: Bot {token}",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: MarinBot/1.0",
            "-d", json.dumps(payload),
        ],
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def discord_edit(channel_id: str, message_id: str, content: str, suppress_embeds: bool = False) -> dict:
    """Edit a bot message on Discord."""
    token = os.environ["DISCORD_TOKEN"]
    payload = {"content": content}
    if suppress_embeds:
        payload["flags"] = 4
    result = subprocess.run(
        [
            "curl", "-s",
            "-X", "PATCH",
            f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}",
            "-H", f"Authorization: Bot {token}",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: MarinBot/1.0",
            "-d", json.dumps(payload),
        ],
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def discord_create_thread(channel_id: str, message_id: str, name: str) -> dict:
    """Create a thread from a message."""
    token = os.environ["DISCORD_TOKEN"]
    result = subprocess.run(
        [
            "curl", "-s",
            "-X", "POST",
            f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}/threads",
            "-H", f"Authorization: Bot {token}",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: MarinBot/1.0",
            "-d", json.dumps({"name": name}),
        ],
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def chunk_message(text: str, limit: int = 1900) -> list[str]:
    """Split text on section boundaries (## headers), with char limit fallback.

    Each section (from one ## header to the next) becomes its own chunk.
    If a single section exceeds the limit, it falls back to line-based splitting.
    """
    # Split on ## headers, keeping the header with its content
    sections = re.split(r'(?=^## )', text, flags=re.MULTILINE)
    # Also split on Slack-style bold headers (*#channel — Title*)
    expanded = []
    for s in sections:
        parts = re.split(r'(?=^\*#\w)', s, flags=re.MULTILINE)
        expanded.extend(parts)

    chunks = []
    for section in expanded:
        section = section.strip()
        if not section:
            continue
        has_header = bool(re.match(r'(?:## |\*#)', section))
        if chunks and not has_header and len(chunks[-1]) + len(section) + 2 <= limit:
            # Only merge headerless continuation text with previous chunk
            chunks[-1] += "\n\n" + section
            continue
        if len(section) <= limit:
            chunks.append(section)
        else:
            # Section too long, fall back to line splitting
            chunk = ""
            for line in section.split("\n"):
                if len(chunk) + len(line) + 1 > limit:
                    chunks.append(chunk)
                    chunk = line
                else:
                    chunk += "\n" + line if chunk else line
            if chunk:
                chunks.append(chunk)
    return chunks


def format_week_title(week_start: str) -> str:
    """Format week range as 'Mar 24–30, 2026' style title."""
    start = datetime.strptime(week_start, "%Y-%m-%d")
    end = start + timedelta(days=6)
    if start.month == end.month:
        return f"{start.strftime('%b')} {start.day}–{end.day}, {start.year}"
    return f"{start.strftime('%b')} {start.day} – {end.strftime('%b')} {end.day}, {start.year}"


def viewer_to_discord_links(text: str, viewer_base: str, guild_id: str) -> str:
    """Convert viewer URLs to Discord message URLs."""
    if not viewer_base or not guild_id:
        return text
    # viewer: https://marin-discord.pages.dev/#CHANNEL_ID/MESSAGE_ID
    # discord: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
    escaped = re.escape(viewer_base.rstrip("/"))
    return re.sub(
        rf'{escaped}/#(\d+)/(\d+)',
        rf'https://discord.com/channels/{guild_id}/\1/\2',
        text,
    )


def post_to_discord(summary: dict, channel_id: str, week_start: str, guild_id: str = ""):
    """Post XS as main message, then S and M in a thread. Edits S to add jump links."""
    # Convert viewer links to Discord links for in-Discord posting
    summary = {
        k: viewer_to_discord_links(v, VIEWER_BASE, guild_id)
        for k, v in summary.items()
    }

    title = f"Weekly Digest: {format_week_title(week_start)}"
    xs_content = f"# {title}\n{summary['xs']}"

    xs_msg = discord_post(channel_id, xs_content, suppress_embeds=True)
    if "id" not in xs_msg:
        err(f"Discord XS post failed: {xs_msg}")
        return
    err(f"Posted XS (msg {xs_msg['id']})")

    thread_name = title
    thread = discord_create_thread(channel_id, xs_msg["id"], thread_name)
    if "id" not in thread:
        err(f"Thread creation failed: {thread}")
        return
    thread_id = thread["id"]
    err(f"Created thread '{thread_name}' (id {thread_id})")

    # Post S summary in thread (will be edited later with jump links)
    time.sleep(1)
    s_msg = discord_post(thread_id, summary["s"], suppress_embeds=True)
    s_msg_id = s_msg.get("id")
    if s_msg_id:
        err(f"Posted S in thread (msg {s_msg_id})")
    else:
        err(f"S post failed: {s_msg}")

    # Post M summary in thread (chunked), tracking which sections land in which message
    m_chunks = chunk_message(summary["m"])
    # Map: section header text → message ID (for jump links)
    section_msg_ids = {}
    for i, chunk in enumerate(m_chunks):
        time.sleep(1)
        m_msg = discord_post(thread_id, chunk, suppress_embeds=True)
        if "id" in m_msg:
            err(f"Posted M chunk {i+1}/{len(m_chunks)} in thread (msg {m_msg['id']})")
            # Find section headers in this chunk
            for match in re.finditer(r'^## .+? — (.+)$', chunk, re.MULTILINE):
                section_msg_ids[match.group(1).strip().lower()] = m_msg["id"]
        else:
            err(f"M chunk {i+1} failed: {m_msg}")

    # Edit S to append jump links to M sections
    if s_msg_id and section_msg_ids and guild_id:
        s_lines = summary["s"].split("\n")
        new_lines = []
        for line in s_lines:
            # Match bullet topic: "- **Topic** —" or "- **Topic (N msgs)** —"
            m = re.match(r'^- \*\*(.+?)\*\*', line)
            if m:
                topic = m.group(1).split("(")[0].strip().lower()
                topic_words = [w for w in topic.split() if len(w) > 2]
                # Score each section by word overlap with bullet topic
                best_id, best_score = None, 0
                for section_key, msg_id in section_msg_ids.items():
                    sk = section_key.lower()
                    score = sum(1 for w in topic_words if w in sk)
                    if score > best_score:
                        best_id, best_score = msg_id, score
                if best_id:
                    jump_url = f"https://discord.com/channels/{guild_id}/{thread_id}/{best_id}"
                    line = re.sub(r'^(- \*\*.+?\*\*)', rf'\1 ([details]({jump_url}))', line)
            new_lines.append(line)
        updated_s = "\n".join(new_lines)
        if updated_s != summary["s"]:
            time.sleep(1)
            discord_edit(thread_id, s_msg_id, updated_s, suppress_embeds=True)
            err("Edited S with jump links to M sections")


def md_to_mrkdwn(text: str, channel_map: dict[str, str] | None = None) -> str:
    """Convert Markdown to Slack mrkdwn format.

    Args:
        text: Markdown text
        channel_map: Discord channel ID → name mapping
    """
    if channel_map is None:
        channel_map = {}

    def resolve_channel(m):
        ch_id = m.group(1)
        name = channel_map.get(ch_id, ch_id)
        return f"#{name}"

    lines = text.split("\n")
    out = []
    for line in lines:
        # Discord channel mentions: <#ID> → #channel-name
        line = re.sub(r'<#(\d+)>', resolve_channel, line)
        # Headers: ## #channel — Title → *#channel — Title*
        header_match = re.match(r'^#{1,3}\s+(.+)$', line)
        if header_match:
            line = f"*{header_match.group(1)}*"
        # Bold: **text** → *text*
        line = re.sub(r'\*\*(.+?)\*\*', r'*\1*', line)
        # Links: [text](url) → <url|text>
        line = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<\2|\1>', line)
        # Angle-bracket URLs (embed suppression): <https://...> → just the URL
        line = re.sub(r'<(https?://[^>|]+)>', r'\1', line)
        # Bullet lists: - item → • item
        line = re.sub(r'^- ', '• ', line)
        # Horizontal rules
        line = re.sub(r'^---+$', '─' * 40, line)
        out.append(line)
    return "\n".join(out)


def slack_post(token: str, channel: str, text: str, thread_ts: str | None = None) -> dict:
    """Post a message to Slack. Returns API response dict."""
    import urllib.request
    payload = {"channel": channel, "text": text, "mrkdwn": True}
    if thread_ts:
        payload["thread_ts"] = thread_ts
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def load_channel_map(db_path: str) -> dict[str, str]:
    """Load channel ID → name mapping from the archive DB."""
    db = sqlite3.connect(db_path)
    rows = db.execute("SELECT id, name FROM channels").fetchall()
    db.close()
    return {str(r[0]): r[1] for r in rows}


def add_slack_details_links(s_text: str, m_ts_list: list[str], slack_client) -> str:
    """Add positional (details) jump links to S bullet items."""
    lines = s_text.split("\n")
    new_lines = []
    bullet_idx = 0
    for line in lines:
        if re.match(r'^• \*.+?\*', line) and bullet_idx < len(m_ts_list):
            link = slack_client.permalink(m_ts_list[bullet_idx])
            line = re.sub(r'^(• \*.+?\*)', rf'\1 (<{link}|details>)', line)
            bullet_idx += 1
        new_lines.append(line)
    return "\n".join(new_lines)


def post_to_slack(summary: dict, channel_id: str, week_start: str, db_path: str = ""):
    """Post XS/S/M to Slack using thrds for declarative thread sync."""
    from thrds import SlackClient, Thread

    token = os.environ["SLACK_TOKEN"]
    title = f"*Weekly Digest: {format_week_title(week_start)}*"
    channel_map = load_channel_map(db_path) if db_path else {}

    xs = md_to_mrkdwn(summary["xs"], channel_map)
    s = md_to_mrkdwn(summary["s"], channel_map)
    m = md_to_mrkdwn(summary["m"], channel_map)
    m_chunks = chunk_message(m, limit=3500)

    desired = [f"{title}\n{xs}", s] + m_chunks

    slack = SlackClient(token=token, channel=channel_id)
    result = slack.sync(Thread(messages=desired))
    err(f"Slack sync: {len(result.message_ids)} msgs, "
        f"{sum(1 for a in result.actions if a.type.name == 'POST')} posted, "
        f"{sum(1 for a in result.actions if a.type.name == 'EDIT')} edited")

    # Edit S with (details) links pointing to M messages
    s_ts = result.message_ids[1]
    m_ts_list = result.message_ids[2:]
    updated_s = add_slack_details_links(s, m_ts_list, slack)
    if updated_s != s:
        slack.edit(s_ts, updated_s)
        err("Edited S with details links")

    return result


@command()
@option('-d', '--db-path', default=DB_PATH, help='Path to archive.db')
@option('-g', '--guild-id', default=DISCORD_GUILD_ID, help='Discord guild ID (for permalink URLs)')
@option('-n', '--dry-run', is_flag=True, help='Print raw data without calling LLM')
@option('-o', '--output', default='-', help='Output directory or - for stdout')
@option('-v', '--viewer-base', default=VIEWER_BASE, help='Viewer base URL (for permalink URLs)')
@option('-w', '--week', default=None, help='Week start date (Monday), YYYY-MM-DD')
@option('--post-discord', default=None, help='Post to Discord channel ID')
@option('--post-slack', default=None, help='Post to Slack channel ID')
def main(db_path, guild_id, dry_run, output, viewer_base, week, post_discord, post_slack):
    """Generate a weekly Discord activity summary."""
    global VIEWER_BASE, DISCORD_GUILD_ID
    if viewer_base:
        VIEWER_BASE = viewer_base
    if guild_id:
        DISCORD_GUILD_ID = guild_id

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

    # Output
    if output == '-':
        print(json.dumps(summary, indent=2))
    else:
        out_dir = Path(output)
        out_dir.mkdir(parents=True, exist_ok=True)
        for tier in ("xs", "s", "m"):
            (out_dir / f"{tier}.md").write_text(summary[tier] + "\n")
        err(f"Wrote summaries to {out_dir}/{{xs,s,m}}.md")

    # Post to channels
    if post_discord:
        post_to_discord(summary, post_discord, start, guild_id=DISCORD_GUILD_ID)
    if post_slack:
        post_to_slack(summary, post_slack, start, db_path=db_path)


if __name__ == "__main__":
    main()
