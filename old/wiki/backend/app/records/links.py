import re

import aiosqlite

# [[Display text|target_slug]]
WIKI_LINK_PATTERN = re.compile(r"\[\[[^\[\]|]+\|([^\[\]|]+)\]\]")


def extract_link_targets(*texts: str) -> set[str]:
    targets: set[str] = set()
    for text in texts:
        targets.update(WIKI_LINK_PATTERN.findall(text))
    return targets


async def rebuild_links(conn: aiosqlite.Connection, record_id: int, content: str, meta: str) -> None:
    """Recompute this record's outgoing [[...]] links from its current content+meta."""
    await conn.execute("DELETE FROM links WHERE from_record = ?", (record_id,))
    targets = extract_link_targets(content, meta)
    if not targets:
        return
    placeholders = ",".join("?" * len(targets))
    cur = await conn.execute(
        f"SELECT id FROM record WHERE link_name IN ({placeholders})", tuple(targets)
    )
    target_ids = [r["id"] for r in await cur.fetchall()]
    await conn.executemany(
        "INSERT OR IGNORE INTO links (from_record, to_record) VALUES (?, ?)",
        [(record_id, tid) for tid in target_ids],
    )


async def propagate_rename(conn: aiosqlite.Connection, record_id: int, old_slug: str, new_slug: str) -> None:
    """Rewrite [[Display|old_slug]] -> [[Display|new_slug]] in every record linking to this one."""
    if old_slug == new_slug:
        return
    cur = await conn.execute("SELECT from_record FROM links WHERE to_record = ?", (record_id,))
    referencing_ids = [r["from_record"] for r in await cur.fetchall()]
    if not referencing_ids:
        return

    pattern = re.compile(r"(\[\[[^\[\]|]+\|)" + re.escape(old_slug) + r"(\]\])")
    for ref_id in referencing_ids:
        cur = await conn.execute("SELECT content, meta FROM record WHERE id = ?", (ref_id,))
        row = await cur.fetchone()
        new_content = pattern.sub(r"\1" + new_slug + r"\2", row["content"])
        new_meta = pattern.sub(r"\1" + new_slug + r"\2", row["meta"])
        if new_content != row["content"] or new_meta != row["meta"]:
            await conn.execute(
                "UPDATE record SET content = ?, meta = ? WHERE id = ?", (new_content, new_meta, ref_id)
            )
