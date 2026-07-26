from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import Side
from schemas import SideOut

router = APIRouter(prefix="/api/sides", tags=["sides"])


class SideUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None


@router.get("", response_model=list[SideOut])
def get_sides(db: Session = Depends(get_db)):
    return db.query(Side).all()


@router.put("/{tag}", response_model=SideOut)
@router.patch("/{tag}", response_model=SideOut)
def update_side(tag: str, body: SideUpdate, db: Session = Depends(get_db)):
    side = db.get(Side, tag)
    if not side:
        raise HTTPException(404, "Side not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(side, field, value)
    db.commit()
    db.refresh(side)
    return side
