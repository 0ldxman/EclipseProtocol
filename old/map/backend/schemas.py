from pydantic import BaseModel
from typing import Optional


class SideOut(BaseModel):
    tag: str
    label: str
    color: str

    class Config:
        from_attributes = True


class CountryOut(BaseModel):
    tag: str
    name: str
    current_name: Optional[str]
    color: str
    part_of: Optional[str]
    side: Optional[str]
    sympathy: Optional[str]

    class Config:
        from_attributes = True


class CountryCreate(BaseModel):
    tag: str
    name: str
    current_name: Optional[str] = None
    color: str
    part_of: Optional[str] = None
    side: Optional[str] = None
    sympathy: Optional[str] = None


class CountryUpdate(BaseModel):
    name: Optional[str] = None
    current_name: Optional[str] = None
    color: Optional[str] = None
    part_of: Optional[str] = None
    side: Optional[str] = None
    sympathy: Optional[str] = None


class ProvinceUpdate(BaseModel):
    owner: Optional[str] = None
    occupied_by: Optional[str] = None


class ProvinceBulkUpdate(BaseModel):
    fids: list[int]
    owner: Optional[str] = None
    occupied_by: Optional[str] = None
