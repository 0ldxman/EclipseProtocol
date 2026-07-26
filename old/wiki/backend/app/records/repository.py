import json
from datetime import datetime, timezone

import aiosqlite

from app.records.links import propagate_rename, rebuild_links


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _deserialize(row: dict) -> dict:
    row["tags"] = json.loads(row["tags"])
    return row


def _row(row: aiosqlite.Row | None) -> dict | None:
    return _deserialize(dict(row)) if row is not None else None


# --- records -------------------------------------------------------------------


async def list_records(conn: aiosqlite.Connection, *, category: str | None = None) -> list[dict]:
    if category is None:
        cur = await conn.execute("SELECT * FROM record ORDER BY updated_at DESC")
    else:
        cur = await conn.execute(
            "SELECT * FROM record WHERE category = ? ORDER BY updated_at DESC", (category,)
        )
    return [_deserialize(dict(r)) for r in await cur.fetchall()]


async def get_record_by_link_name(conn: aiosqlite.Connection, link_name: str) -> dict | None:
    cur = await conn.execute("SELECT * FROM record WHERE link_name = ?", (link_name,))
    return _row(await cur.fetchone())


async def get_record_by_id(conn: aiosqlite.Connection, record_id: int) -> dict | None:
    cur = await conn.execute("SELECT * FROM record WHERE id = ?", (record_id,))
    return _row(await cur.fetchone())


async def get_access_rows(conn: aiosqlite.Connection, record_id: int) -> list[dict]:
    cur = await conn.execute("SELECT org, level FROM record_access WHERE record_id = ?", (record_id,))
    return [dict(r) for r in await cur.fetchall()]


async def get_backlinks(conn: aiosqlite.Connection, record_id: int) -> list[dict]:
    cur = await conn.execute(
        """
        SELECT r.id, r.link_name, r.title FROM links l
        JOIN record r ON r.id = l.from_record
        WHERE l.to_record = ?
        """,
        (record_id,),
    )
    return [dict(r) for r in await cur.fetchall()]


async def _set_access(conn: aiosqlite.Connection, record_id: int, access: list[dict]) -> None:
    await conn.execute("DELETE FROM record_access WHERE record_id = ?", (record_id,))
    if access:
        await conn.executemany(
            "INSERT INTO record_access (record_id, org, level) VALUES (?, ?, ?)",
            [(record_id, a["org"], a["level"]) for a in access],
        )


async def create_record(
    conn: aiosqlite.Connection,
    *,
    link_name: str,
    title: str,
    category: str,
    tags: list[str],
    content: str,
    meta: str,
    status: str,
    access: list[dict],
) -> dict:
    now = _now()
    cur = await conn.execute(
        """
        INSERT INTO record (link_name, title, category, tags, content, meta, status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (link_name, title, category, json.dumps(tags), content, meta, status, now, now),
    )
    record_id = cur.lastrowid
    await _set_access(conn, record_id, access)
    await rebuild_links(conn, record_id, content, meta)
    return await get_record_by_id(conn, record_id)


async def update_record(
    conn: aiosqlite.Connection,
    record_id: int,
    *,
    link_name: str | None,
    title: str | None,
    category: str | None,
    tags: list[str] | None,
    content: str | None,
    meta: str | None,
    status: str | None,
    access: list[dict] | None,
) -> dict | None:
    existing = await get_record_by_id(conn, record_id)
    if existing is None:
        return None

    new_link_name = link_name or existing["link_name"]
    new_content = existing["content"] if content is None else content
    new_meta = existing["meta"] if meta is None else meta

    await conn.execute(
        """
        UPDATE record
        SET link_name = ?, title = ?, category = ?, tags = ?, content = ?, meta = ?, status = ?,
            version = version + 1, updated_at = ?
        WHERE id = ?
        """,
        (
            new_link_name,
            title or existing["title"],
            category or existing["category"],
            json.dumps(tags) if tags is not None else json.dumps(existing["tags"]),
            new_content,
            new_meta,
            status or existing["status"],
            _now(),
            record_id,
        ),
    )

    if new_link_name != existing["link_name"]:
        await propagate_rename(conn, record_id, existing["link_name"], new_link_name)

    if access is not None:
        await _set_access(conn, record_id, access)

    await rebuild_links(conn, record_id, new_content, new_meta)
    return await get_record_by_id(conn, record_id)


async def delete_record(conn: aiosqlite.Connection, record_id: int) -> None:
    await conn.execute("DELETE FROM record WHERE id = ?", (record_id,))
