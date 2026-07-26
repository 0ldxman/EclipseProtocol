from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.dependencies import require_admin
from app.db import get_conn

router = APIRouter(prefix="/categories", tags=["categories"])


class CategoryIn(BaseModel):
    name: str


@router.get("")
async def list_categories(settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        cur = await conn.execute("SELECT name FROM category ORDER BY name")
        return [r["name"] for r in await cur.fetchall()]


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_category(body: CategoryIn, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        await conn.execute("INSERT OR IGNORE INTO category (name) VALUES (?)", (body.name,))
    return {"name": body.name}


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_category(name: str, settings: Annotated[Settings, Depends(get_settings)]):
    async with get_conn(settings) as conn:
        cur = await conn.execute("SELECT 1 FROM record WHERE category = ? LIMIT 1", (name,))
        if await cur.fetchone() is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "category still has records")
        await conn.execute("DELETE FROM category WHERE name = ?", (name,))
