import json
from dataclasses import dataclass

import aiosqlite


@dataclass(frozen=True)
class OrgAccess:
    organization_tag: str
    organization_name: str
    level: int
    label: str
    permissions: list[str]


@dataclass(frozen=True)
class AccessResult:
    is_admin: bool
    organizations: list[OrgAccess]


async def resolve_access(conn: aiosqlite.Connection, discord_role_ids: set[str]) -> AccessResult:
    """Map a member's Discord role IDs to global admin flag + per-org access tier.

    A user can belong to several organizations at once (matched by each
    organization's membership role). Within an organization, the
    highest-`lvl` org_access tier whose access_roles entry the user holds
    wins; holding no matching access tier falls back to a bare "member"
    tier (level 0, no permissions).
    """
    admin_cur = await conn.execute("SELECT discord_role_id FROM admin_roles")
    admin_role_ids = {r["discord_role_id"] for r in await admin_cur.fetchall()}
    is_admin = bool(discord_role_ids & admin_role_ids)

    organizations: list[OrgAccess] = []
    org_cur = await conn.execute("SELECT * FROM org")
    for org in await org_cur.fetchall():
        if org["role_id"] not in discord_role_ids:
            continue

        tier_cur = await conn.execute(
            """
            SELECT oa.label, oa.lvl, oa.permissions, ar.discord_role_id
            FROM org_access oa
            JOIN access_roles ar ON ar.access_id = oa.id
            WHERE oa.org_tag = ?
            ORDER BY oa.lvl DESC
            """,
            (org["tag"],),
        )
        matched = next(
            (row for row in await tier_cur.fetchall() if row["discord_role_id"] in discord_role_ids),
            None,
        )

        if matched is not None:
            label = matched["label"]
            level = matched["lvl"]
            permissions = json.loads(matched["permissions"])
        else:
            label = "member"
            level = 0
            permissions = []

        organizations.append(
            OrgAccess(
                organization_tag=org["tag"],
                organization_name=org["name"],
                level=level,
                label=label,
                permissions=permissions,
            )
        )

    return AccessResult(is_admin=is_admin, organizations=organizations)
