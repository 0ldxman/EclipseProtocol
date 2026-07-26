import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.dependencies import get_current_user, require_admin
from app.core.security import CurrentUser
from app.db import get_conn
from app.records import repository as records_repo
from app.records.markup import excerpt, first_image_url, parse_markup
from app.timeline import repository as repo
from app.timeline.schemas import TimelineIn, TimelinePatch, TimelineSettingsIn

router = APIRouter(prefix="/timeline", tags=["timeline"])


def _serialize(row: dict) -> dict:
    """Лёгкая точка таймлайна: всё для ленты и ховеркарда, без полного content."""
    content_ast = parse_markup(row["content"])
    meta_ast = parse_markup(row["meta"])
    return {
        "id": row["id"],
        "record_id": row["record_id"],
        "link_name": row["link_name"],
        "title": row["title"],
        "category": row["category"],
        "tags": json.loads(row["tags"]),
        "status": row["status"],
        "kind": row["kind"],
        "event_date": row["event_date"],
        "end_date": row["end_date"],
        "note": row["note"],
        "cover": first_image_url(meta_ast) or first_image_url(content_ast),
        "excerpt": excerpt(content_ast),
    }


@router.get("")
async def list_timeline(
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
):
    """Публичная лента — только опубликованные записи. Админу видны и черновики."""
    async with get_conn(settings) as conn:
        rows = await repo.list_entries(conn)
        return [
            _serialize(r)
            for r in rows
            if r["status"] == "published" or user.is_admin
        ]


@router.get("/settings")
async def get_timeline_settings(settings: Annotated[Settings, Depends(get_settings)]):
    """Публично: внутримировая «текущая дата» и подпись у терминатора."""
    async with get_conn(settings) as conn:
        return await repo.get_settings_row(conn)


@router.put("/settings", dependencies=[Depends(require_admin)])
async def put_timeline_settings(
    body: TimelineSettingsIn, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        return await repo.update_settings(
            conn, current_date=body.current_date, current_label=body.current_label
        )


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def add_to_timeline(body: TimelineIn, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        record = await records_repo.get_record_by_id(conn, body.record_id)
        if record is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "record not found")
        if await repo.get_entry_by_record(conn, body.record_id) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "record already on timeline")
        return await repo.create_entry(
            conn,
            record_id=body.record_id,
            kind=body.kind,
            event_date=body.event_date,
            end_date=body.end_date,
            note=body.note,
        )


@router.patch("/{entry_id}", dependencies=[Depends(require_admin)])
async def update_timeline(
    entry_id: int, body: TimelinePatch, settings: Annotated[Settings, Depends(get_settings)]
):
    async with get_conn(settings) as conn:
        entry = await repo.update_entry(
            conn,
            entry_id,
            kind=body.kind,
            event_date=body.event_date,
            end_date=body.end_date,
            note=body.note,
        )
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "timeline entry not found")
    return entry


@router.delete(
    "/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)]
)
async def remove_from_timeline(entry_id: int, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await repo.delete_entry(conn, entry_id)
