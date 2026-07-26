import json

import aiosqlite


def _row(row: aiosqlite.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def _with_permissions(row: dict | None) -> dict | None:
    if row is None:
        return None
    row["permissions"] = json.loads(row["permissions"])
    return row


# --- org ---------------------------------------------------------------------


async def list_orgs(conn: aiosqlite.Connection) -> list[dict]:
    cur = await conn.execute("SELECT * FROM org ORDER BY name")
    return [dict(r) for r in await cur.fetchall()]


async def create_org(conn: aiosqlite.Connection, *, tag: str, name: str, role_id: str) -> dict:
    await conn.execute("INSERT INTO org (tag, name, role_id) VALUES (?, ?, ?)", (tag, name, role_id))
    cur = await conn.execute("SELECT * FROM org WHERE tag = ?", (tag,))
    return _row(await cur.fetchone())


async def update_org(
    conn: aiosqlite.Connection, tag: str, *, name: str | None, role_id: str | None
) -> dict | None:
    cur = await conn.execute("SELECT * FROM org WHERE tag = ?", (tag,))
    existing = _row(await cur.fetchone())
    if existing is None:
        return None
    await conn.execute(
        "UPDATE org SET name = ?, role_id = ? WHERE tag = ?",
        (name or existing["name"], role_id or existing["role_id"], tag),
    )
    cur = await conn.execute("SELECT * FROM org WHERE tag = ?", (tag,))
    return _row(await cur.fetchone())


async def delete_org(conn: aiosqlite.Connection, tag: str) -> None:
    await conn.execute("DELETE FROM org WHERE tag = ?", (tag,))


# --- org access tiers ---------------------------------------------------------


async def list_org_access(conn: aiosqlite.Connection, org_tag: str | None = None) -> list[dict]:
    if org_tag is None:
        cur = await conn.execute("SELECT * FROM org_access ORDER BY org_tag, lvl DESC")
    else:
        cur = await conn.execute(
            "SELECT * FROM org_access WHERE org_tag = ? ORDER BY lvl DESC", (org_tag,)
        )
    return [_with_permissions(dict(r)) for r in await cur.fetchall()]


async def create_org_access(
    conn: aiosqlite.Connection, *, org_tag: str, label: str, lvl: int, permissions: list[str]
) -> dict:
    cur = await conn.execute(
        "INSERT INTO org_access (org_tag, label, lvl, permissions) VALUES (?, ?, ?, ?)",
        (org_tag, label, lvl, json.dumps(permissions)),
    )
    row_cur = await conn.execute("SELECT * FROM org_access WHERE id = ?", (cur.lastrowid,))
    return _with_permissions(_row(await row_cur.fetchone()))


async def update_org_access(
    conn: aiosqlite.Connection,
    access_id: int,
    *,
    label: str | None,
    lvl: int | None,
    permissions: list[str] | None,
) -> dict | None:
    cur = await conn.execute("SELECT * FROM org_access WHERE id = ?", (access_id,))
    existing = _row(await cur.fetchone())
    if existing is None:
        return None
    new_permissions = existing["permissions"] if permissions is None else json.dumps(permissions)
    await conn.execute(
        "UPDATE org_access SET label = ?, lvl = ?, permissions = ? WHERE id = ?",
        (
            label or existing["label"],
            existing["lvl"] if lvl is None else lvl,
            new_permissions,
            access_id,
        ),
    )
    cur = await conn.execute("SELECT * FROM org_access WHERE id = ?", (access_id,))
    return _with_permissions(_row(await cur.fetchone()))


async def delete_org_access(conn: aiosqlite.Connection, access_id: int) -> None:
    await conn.execute("DELETE FROM org_access WHERE id = ?", (access_id,))


# --- access roles (discord role -> access tier) --------------------------------


async def list_access_roles(conn: aiosqlite.Connection, access_id: int) -> list[str]:
    cur = await conn.execute(
        "SELECT discord_role_id FROM access_roles WHERE access_id = ?", (access_id,)
    )
    return [r["discord_role_id"] for r in await cur.fetchall()]


async def add_access_role(conn: aiosqlite.Connection, access_id: int, discord_role_id: str) -> None:
    await conn.execute(
        "INSERT OR IGNORE INTO access_roles (access_id, discord_role_id) VALUES (?, ?)",
        (access_id, discord_role_id),
    )


async def remove_access_role(conn: aiosqlite.Connection, access_id: int, discord_role_id: str) -> None:
    await conn.execute(
        "DELETE FROM access_roles WHERE access_id = ? AND discord_role_id = ?",
        (access_id, discord_role_id),
    )


# --- global admin roles --------------------------------------------------------


async def list_admin_roles(conn: aiosqlite.Connection) -> list[str]:
    cur = await conn.execute("SELECT discord_role_id FROM admin_roles")
    return [r["discord_role_id"] for r in await cur.fetchall()]


async def add_admin_role(conn: aiosqlite.Connection, discord_role_id: str) -> None:
    await conn.execute(
        "INSERT OR IGNORE INTO admin_roles (discord_role_id) VALUES (?)", (discord_role_id,)
    )


async def remove_admin_role(conn: aiosqlite.Connection, discord_role_id: str) -> None:
    await conn.execute("DELETE FROM admin_roles WHERE discord_role_id = ?", (discord_role_id,))
