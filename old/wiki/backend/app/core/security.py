from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt

from app.core.config import Settings

_public_key: str | None = None


async def load_public_key(settings: Settings) -> None:
    """Fetch and cache aether-auth's public key. Call once at startup."""
    global _public_key
    async with httpx.AsyncClient() as client:
        resp = await client.get(settings.auth_jwt_public_key_url)
    resp.raise_for_status()
    _public_key = resp.text


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    if _public_key is None:
        raise RuntimeError("public key not loaded - call load_public_key() at startup")
    return jwt.decode(
        token,
        _public_key,
        algorithms=["RS256"],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
    )


@dataclass(frozen=True)
class CurrentUser:
    is_admin: bool = False
    organizations: list[dict] = field(default_factory=list)

    def level_in(self, org_tag: str) -> int:
        return next((o["level"] for o in self.organizations if o["tag"] == org_tag), -1)
