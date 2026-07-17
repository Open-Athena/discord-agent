"""Channels excluded from archiving by policy.

`#internal-discuss` is private: the bot (via the "Marin Archiver" role) may
read it for on-demand CLI queries (`cli.py read`), but its contents must never
be persisted — not in the DVX-tracked `archive/` JSON, `archive.db`, D1, or
the deployed viewer. See `specs/internal-discuss-on-demand.md`.

Dependency-free so both `archive.py` (fetch layer) and `build_db.py`
(belt-and-suspenders assert) can import the same set.
"""

EXCLUDED_CHANNEL_IDS = {
    "1412294350645493840",  # internal-discuss
}
