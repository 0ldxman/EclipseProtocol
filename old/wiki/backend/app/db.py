from contextlib import asynccontextmanager

import aiosqlite

from app.core.config import Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS category (
    name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES category(name),
    tags TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
    from_record INTEGER NOT NULL REFERENCES record(id) ON DELETE CASCADE,
    to_record INTEGER NOT NULL REFERENCES record(id) ON DELETE CASCADE,
    PRIMARY KEY (from_record, to_record)
);

CREATE TABLE IF NOT EXISTS record_access (
    record_id INTEGER NOT NULL REFERENCES record(id) ON DELETE CASCADE,
    org TEXT NOT NULL,
    level INTEGER NOT NULL,
    PRIMARY KEY (record_id, org)
);

-- Курируемый таймлайн Eclipse Protocol. Одна запись = одна точка/эпоха.
-- Порядок строится по внутримировой дате event_date (строка YYYY[.MM[.DD]]).
CREATE TABLE IF NOT EXISTS timeline_entry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL UNIQUE REFERENCES record(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'epoch')),
    event_date TEXT NOT NULL,
    end_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Настройки таймлайна (синглтон, id = 1): внутримировая «текущая дата»
-- у терминатора «СЕЙЧАС» и подпись под ней.
-- now_date/now_label — не current_date: CURRENT_DATE зарезервирован в SQLite.
CREATE TABLE IF NOT EXISTS timeline_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    now_date TEXT NOT NULL DEFAULT '',
    now_label TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
"""

_connections: dict[str, aiosqlite.Connection] = {}


async def init_db(settings: Settings) -> None:
    conn = await aiosqlite.connect(settings.database_path)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON")
    await conn.executescript(SCHEMA)
    await conn.commit()
    _connections[settings.database_path] = conn


async def close_db(settings: Settings) -> None:
    conn = _connections.pop(settings.database_path, None)
    if conn is not None:
        await conn.close()


@asynccontextmanager
async def get_conn(settings: Settings):
    conn = _connections[settings.database_path]
    try:
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
