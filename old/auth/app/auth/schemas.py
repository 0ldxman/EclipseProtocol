from pydantic import BaseModel


class PasswordLoginIn(BaseModel):
    password: str


class OrgClaim(BaseModel):
    tag: str
    name: str
    level: int
    label: str
    permissions: list[str]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    discord_id: str
    username: str
    is_admin: bool
    organizations: list[OrgClaim]


class MeResponse(BaseModel):
    discord_id: str
    username: str
    is_admin: bool
    organizations: list[OrgClaim]
