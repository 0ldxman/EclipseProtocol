from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Province
from schemas import ProvinceUpdate, ProvinceBulkUpdate
from routers.map import notify_provinces_changed

router = APIRouter(prefix="/api/provinces", tags=["provinces"])


@router.put("/{fid}")
@router.patch("/{fid}")
def update_province(fid: int, body: ProvinceUpdate, db: Session = Depends(get_db)):
    province = db.get(Province, fid)
    old_state = (province.owner, province.occupied_by) if province else (None, None)
    if not province:
        province = Province(fid=fid)
        db.add(province)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(province, field, value)
    db.commit()
    notify_provinces_changed({fid: old_state})
    return {"ok": True}


@router.post("/bulk")
def bulk_update_provinces(body: ProvinceBulkUpdate, db: Session = Depends(get_db)):
    updates = body.model_dump(exclude_unset=True)
    fids = updates.pop("fids")
    old_states = {}
    for fid in fids:
        province = db.get(Province, fid)
        old_states[fid] = (province.owner, province.occupied_by) if province else (None, None)
        if not province:
            province = Province(fid=fid)
            db.add(province)
        for field, value in updates.items():
            setattr(province, field, value)
    db.commit()
    notify_provinces_changed(old_states)
    return {"ok": True, "updated": len(fids)}
