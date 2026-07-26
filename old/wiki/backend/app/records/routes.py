from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.dependencies import get_current_user, require_admin
from app.core.security import CurrentUser
from app.db import get_conn
from app.records import repository as repo
from app.records.access import can_view
from app.records.markup import parse_markup
from app.records.schemas import RecordIn, RecordPatch

router = APIRouter(prefix="/records", tags=["records"])


@router.get("")
async def list_records(
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
    category: str | None = None,
):
    async with get_conn(settings) as conn:
        records = await repo.list_records(conn, category=category)
        visible = []
        for record in records:
            access_rows = await repo.get_access_rows(conn, record["id"])
            if can_view(user, record["status"], access_rows):
                visible.append(record)
        return visible


@router.get("/{link_name}")
async def get_record(
    link_name: str,
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
):
    async with get_conn(settings) as conn:
        record = await repo.get_record_by_link_name(conn, link_name)
        if record is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "record not found")
        access_rows = await repo.get_access_rows(conn, record["id"])
        if not can_view(user, record["status"], access_rows):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "record not found")
        record["access"] = access_rows
        record["backlinks"] = await repo.get_backlinks(conn, record["id"])
        record["content_ast"] = parse_markup(record["content"])
        record["meta_ast"] = parse_markup(record["meta"])
        return record


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_record(body: RecordIn, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        return await repo.create_record(
            conn,
            link_name=body.link_name,
            title=body.title,
            category=body.category,
            tags=body.tags,
            content=body.content,
            meta=body.meta,
            status=body.status,
            access=[a.model_dump() for a in body.access],
        )


@router.patch("/{record_id}", dependencies=[Depends(require_admin)])
async def update_record(
    record_id: int, body: RecordPatch, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        record = await repo.update_record(
            conn,
            record_id,
            link_name=body.link_name,
            title=body.title,
            category=body.category,
            tags=body.tags,
            content=body.content,
            meta=body.meta,
            status=body.status,
            access=[a.model_dump() for a in body.access] if body.access is not None else None,
        )
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "record not found")
    return record


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_record(record_id: int, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.delete_record(conn, record_id)
