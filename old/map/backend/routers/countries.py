from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Country
from schemas import CountryOut, CountryCreate, CountryUpdate

router = APIRouter(prefix="/api/countries", tags=["countries"])


@router.get("", response_model=list[CountryOut])
def get_countries(db: Session = Depends(get_db)):
    return db.query(Country).order_by(Country.name).all()


@router.post("", response_model=CountryOut, status_code=201)
def create_country(body: CountryCreate, db: Session = Depends(get_db)):
    if db.get(Country, body.tag):
        raise HTTPException(400, f"Country '{body.tag}' already exists")
    country = Country(**body.model_dump())
    db.add(country)
    db.commit()
    db.refresh(country)
    return country


@router.put("/{tag}", response_model=CountryOut)
@router.patch("/{tag}", response_model=CountryOut)
def update_country(tag: str, body: CountryUpdate, db: Session = Depends(get_db)):
    country = db.get(Country, tag)
    if not country:
        raise HTTPException(404, "Country not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(country, field, value)
    db.commit()
    db.refresh(country)
    return country


@router.delete("/{tag}", status_code=204)
def delete_country(tag: str, db: Session = Depends(get_db)):
    country = db.get(Country, tag)
    if not country:
        raise HTTPException(404, "Country not found")
    db.delete(country)
    db.commit()
