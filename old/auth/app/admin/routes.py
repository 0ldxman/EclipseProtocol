from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.admin import repository as repo
from app.admin.dependencies import require_admin
from app.admin.schemas import (
    AccessRoleIn,
    AdminRoleIn,
    OrgAccessIn,
    OrgAccessPatch,
    OrgIn,
    OrgPatch,
)
from app.core.config import Settings, get_settings
from app.db import get_conn

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# --- org -----------------------------------------------------------------------


@router.get("/orgs")
async def list_orgs(settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.list_orgs(conn)


@router.post("/orgs", status_code=status.HTTP_201_CREATED)
async def create_org(body: OrgIn, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.create_org(conn, tag=body.tag, name=body.name, role_id=body.role_id)


@router.patch("/orgs/{tag}")
async def update_org(tag: str, body: OrgPatch, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        org = await repo.update_org(conn, tag, name=body.name, role_id=body.role_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "org not found")
    return org


@router.delete("/orgs/{tag}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org(tag: str, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.delete_org(conn, tag)


# --- org access tiers ------------------------------------------------------------


@router.get("/orgs/{org_tag}/access")
async def list_org_access(org_tag: str, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.list_org_access(conn, org_tag=org_tag)


@router.post("/orgs/{org_tag}/access", status_code=status.HTTP_201_CREATED)
async def create_org_access(
    org_tag: str, body: OrgAccessIn, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        return await repo.create_org_access(
            conn, org_tag=org_tag, label=body.label, lvl=body.lvl, permissions=body.permissions
        )


@router.patch("/access/{access_id}")
async def update_org_access(
    access_id: int, body: OrgAccessPatch, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        access = await repo.update_org_access(
            conn, access_id, label=body.label, lvl=body.lvl, permissions=body.permissions
        )
    if access is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "org access tier not found")
    return access


@router.delete("/access/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_access(access_id: int, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.delete_org_access(conn, access_id)


# --- access roles (discord role -> access tier) -----------------------------------


@router.get("/access/{access_id}/roles")
async def list_access_roles(access_id: int, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.list_access_roles(conn, access_id)


@router.post("/access/{access_id}/roles", status_code=status.HTTP_201_CREATED)
async def add_access_role(
    access_id: int, body: AccessRoleIn, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        await repo.add_access_role(conn, access_id, body.discord_role_id)
        return await repo.list_access_roles(conn, access_id)


@router.delete("/access/{access_id}/roles/{discord_role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_access_role(
    access_id: int, discord_role_id: str, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        await repo.remove_access_role(conn, access_id, discord_role_id)


# --- global admin roles -----------------------------------------------------------


@router.get("/admin-roles")
async def list_admin_roles(settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.list_admin_roles(conn)


@router.post("/admin-roles", status_code=status.HTTP_201_CREATED)
async def add_admin_role(body: AdminRoleIn, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.add_admin_role(conn, body.discord_role_id)
        return await repo.list_admin_roles(conn)


@router.delete("/admin-roles/{discord_role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_admin_role(discord_role_id: str, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.remove_admin_role(conn, discord_role_id)
