"""Discord API helpers using curl (avoids Cloudflare blocking Python user-agents)."""

import json
import subprocess
import sys
import time
from functools import partial

err = partial(print, file=sys.stderr)


def discord_request(
    method: str,
    path: str,
    token: str | None = None,
    json_body: dict | None = None,
    suppress_embeds: bool = False,
) -> dict | list | None:
    """Make a Discord API request via curl. Returns parsed JSON response."""
    import os
    token = token or os.environ["DISCORD_TOKEN"]
    url = f"https://discord.com/api/v10{path}"

    cmd = [
        "curl", "-sS",
        "-X", method,
        "-H", f"Authorization: Bot {token}",
        "-H", "Content-Type: application/json",
    ]

    if json_body is not None:
        if suppress_embeds:
            json_body["flags"] = json_body.get("flags", 0) | (1 << 2)
        cmd += ["-d", json.dumps(json_body)]

    while True:
        result = subprocess.run(cmd + [url], capture_output=True, text=True)
        if result.returncode != 0:
            err(f"curl failed: {result.stderr}")
            return None

        if not result.stdout.strip():
            return None

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            err(f"Invalid JSON response: {result.stdout[:200]}")
            return None

        # Rate limit handling
        if isinstance(data, dict) and data.get("retry_after"):
            wait = data["retry_after"] + 0.5
            err(f"Rate limited, waiting {wait:.1f}s...")
            time.sleep(wait)
            continue

        return data


def discord_post(
    channel_id: str,
    content: str,
    token: str | None = None,
    suppress_embeds: bool = False,
) -> str | None:
    """Post a message to a Discord channel. Returns the message ID."""
    data = discord_request(
        "POST",
        f"/channels/{channel_id}/messages",
        token=token,
        json_body={"content": content},
        suppress_embeds=suppress_embeds,
    )
    if data and "id" in data:
        return data["id"]
    err(f"Post failed: {data}")
    return None


def discord_edit(
    channel_id: str,
    message_id: str,
    content: str,
    token: str | None = None,
) -> bool:
    """Edit a bot message. Returns True on success."""
    data = discord_request(
        "PATCH",
        f"/channels/{channel_id}/messages/{message_id}",
        token=token,
        json_body={"content": content},
    )
    return data is not None and "id" in data


def discord_delete(
    channel_id: str,
    message_id: str,
    token: str | None = None,
) -> bool:
    """Delete a message. Returns True on success."""
    discord_request(
        "DELETE",
        f"/channels/{channel_id}/messages/{message_id}",
        token=token,
    )
    return True


def discord_create_thread(
    channel_id: str,
    message_id: str,
    name: str,
    token: str | None = None,
) -> str | None:
    """Create a thread from a message. Returns the thread channel ID."""
    data = discord_request(
        "POST",
        f"/channels/{channel_id}/messages/{message_id}/threads",
        token=token,
        json_body={"name": name},
    )
    if data and "id" in data:
        return data["id"]
    err(f"Thread creation failed: {data}")
    return None


def discord_list_messages(
    channel_id: str,
    limit: int = 50,
    token: str | None = None,
) -> list[dict]:
    """List recent messages in a channel."""
    data = discord_request(
        "GET",
        f"/channels/{channel_id}/messages?limit={limit}",
        token=token,
    )
    return data if isinstance(data, list) else []


def chunk_message(text: str, limit: int = 1900) -> list[str]:
    """Split text into chunks respecting Discord's 2000 char limit."""
    if len(text) <= limit:
        return [text]
    chunks = []
    lines = text.split("\n")
    chunk = ""
    for line in lines:
        if len(chunk) + len(line) + 1 > limit:
            if chunk:
                chunks.append(chunk)
            chunk = line
        else:
            chunk += "\n" + line if chunk else line
    if chunk:
        chunks.append(chunk)
    return chunks
