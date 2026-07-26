from pydantic import BaseModel, Field


class OrgIn(BaseModel):
    tag: str
    name: str
    role_id: str


class OrgPatch(BaseModel):
    name: str | None = None
    role_id: str | None = None


class OrgAccessIn(BaseModel):
    label: str
    lvl: int = 0
    permissions: list[str] = Field(default_factory=list)


class OrgAccessPatch(BaseModel):
    label: str | None = None
    lvl: int | None = None
    permissions: list[str] | None = None


class AccessRoleIn(BaseModel):
    discord_role_id: str


class AdminRoleIn(BaseModel):
    discord_role_id: str
