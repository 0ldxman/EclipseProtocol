from typing import Literal

from pydantic import BaseModel, Field


class RecordAccessIn(BaseModel):
    org: str
    level: int


class RecordIn(BaseModel):
    link_name: str
    title: str
    category: str
    tags: list[str] = Field(default_factory=list)
    content: str = ""
    meta: str = ""
    status: Literal["draft", "published"] = "draft"
    access: list[RecordAccessIn] = Field(default_factory=list)


class RecordPatch(BaseModel):
    link_name: str | None = None
    title: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    content: str | None = None
    meta: str | None = None
    status: Literal["draft", "published"] | None = None
    access: list[RecordAccessIn] | None = None
