from datetime import datetime, timezone

import aiosqlite


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def list_entries(conn: aiosqlite.Connection) -> list[dict]:
    """Точки таймлайна вместе с полями записи. Сортировка по внутримировой дате."""
    cur = await conn.execute(
        """
        SELECT t.id, t.record_id, t.kind, t.event_date, t.end_date, t.note,
               r.link_name, r.title, r.category, r.tags, r.content, r.meta, r.status
        FROM timeline_entry t
        JOIN record r ON r.id = t.record_id
        ORDER BY t.event_date ASC, t.id ASC
        """
    )
    return [dict(r) for r in await cur.fetchall()]


async def get_entry(conn: aiosqlite.Connection, entry_id: int) -> dict | None:
    cur = await conn.execute("SELECT * FROM timeline_entry WHERE id = ?", (entry_id,))
    row = await cur.fetchone()
    return dict(row) if row is not None else None


async def get_entry_by_record(conn: aiosqlite.Connection, record_id: int) -> dict | None:
    cur = await conn.execute("SELECT * FROM timeline_entry WHERE record_id = ?", (record_id,))
    row = await cur.fetchone()
    return dict(row) if row is not None else None


async def create_entry(
    conn: aiosqlite.Connection,
    *,
    record_id: int,
    kind: str,
    event_date: str,
    end_date: str | None,
    note: str,
) -> dict:
    now = _now()
    cur = await conn.execute(
        """
        INSERT INTO timeline_entry (record_id, kind, event_date, end_date, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (record_id, kind, event_date, end_date or None, note, now, now),
    )
    return await get_entry(conn, cur.lastrowid)


async def update_entry(
    conn: aiosqlite.Connection,
    entry_id: int,
    *,
    kind: str | None,
    event_date: str | None,
    end_date: str | None,
    note: str | None,
) -> dict | None:
    existing = await get_entry(conn, entry_id)
    if existing is None:
        return None
    await conn.execute(
        """
        UPDATE timeline_entry
        SET kind = ?, event_date = ?, end_date = ?, note = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            kind or existing["kind"],
            event_date or existing["event_date"],
            # пустая строка очищает диапазон, None — оставляет как есть
            (end_date or None) if end_date is not None else existing["end_date"],
            note if note is not None else existing["note"],
            _now(),
            entry_id,
        ),
    )
    return await get_entry(conn, entry_id)


async def delete_entry(conn: aiosqlite.Connection, entry_id: int) -> None:
    await conn.execute("DELETE FROM timeline_entry WHERE id = ?", (entry_id,))


# --- настройки таймлайна (синглтон) -------------------------------------------

# Технический дефолт подписи у терминатора «СЕЙЧАС» — без внутримировых сущностей.
DEFAULT_CURRENT_LABEL = "Регистрация событий активна · хроника синхронизирована"


async def get_settings_row(conn: aiosqlite.Connection) -> dict:
    """Настройки терминатора. Если строки ещё нет — технические дефолты."""
    cur = await conn.execute(
        "SELECT now_date, now_label FROM timeline_settings WHERE id = 1"
    )
    row = await cur.fetchone()
    if row is None:
        return {"current_date": "", "current_label": DEFAULT_CURRENT_LABEL}
    return {"current_date": row["now_date"], "current_label": row["now_label"]}


async def update_settings(
    conn: aiosqlite.Connection, *, current_date: str, current_label: str
) -> dict:
    await conn.execute(
        """
        INSERT INTO timeline_settings (id, now_date, now_label, updated_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            now_date = excluded.now_date,
            now_label = excluded.now_label,
            updated_at = excluded.updated_at
        """,
        (current_date, current_label, _now()),
    )
    return await get_settings_row(conn)
