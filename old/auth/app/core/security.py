import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt

from app.core.config import Settings
from app.roles import AccessResult


@lru_cache
def _load_key(path: str) -> str:
    return Path(path).read_text()


def _org_claims(access: AccessResult) -> list[dict]:
    return [
        {
            "tag": org.organization_tag,
            "name": org.organization_name,
            "level": org.level,
            "label": org.label,
            "permissions": org.permissions,
        }
        for org in access.organizations
    ]


def issue_access_token(
    settings: Settings, *, discord_id: str, username: str, access: AccessResult
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "sub": discord_id,
        "username": username,
        "is_admin": access.is_admin,
        "organizations": _org_claims(access),
        "iat": now,
        "exp": now + settings.access_token_ttl_seconds,
        "jti": str(uuid.uuid4()),
    }
    private_key = _load_key(settings.jwt_private_key_path)
    return jwt.encode(claims, private_key, algorithm="RS256")


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    public_key = _load_key(settings.jwt_public_key_path)
    return jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
    )


def public_key_pem(settings: Settings) -> str:
    return _load_key(settings.jwt_public_key_path)
