from contextlib import asynccontextmanager

import aiosqlite

from app.core.config import Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS org (
    tag TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role_id TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS org_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_tag TEXT NOT NULL REFERENCES org(tag) ON DELETE CASCADE,
    label TEXT NOT NULL,
    lvl INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS access_roles (
    access_id INTEGER NOT NULL REFERENCES org_access(id) ON DELETE CASCADE,
    discord_role_id TEXT NOT NULL,
    PRIMARY KEY (access_id, discord_role_id)
);

CREATE TABLE IF NOT EXISTS admin_roles (
    discord_role_id TEXT PRIMARY KEY
);
"""

_connections: dict[str, aiosqlite.Connection] = {}


async def init_db(settings: Settings) -> None:
    """Open the (single, process-wide) connection and run the schema. Call once at startup."""
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
    """Yields the shared aiosqlite connection for this db path.

    aiosqlite runs each connection's operations on its own dedicated
    background thread and serializes them through an internal queue, so
    awaiting on this one shared connection from multiple request handlers
    concurrently is safe without any locking of our own.
    """
    conn = _connections[settings.database_path]
    try:
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
