from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> CurrentUser:
    """No/invalid token -> anonymous user, not an error. Visibility checks decide what an
    anonymous user can see; only admin-only endpoints reject them outright (see require_admin)."""
    if credentials is None:
        return CurrentUser()
    try:
        claims = decode_access_token(settings, credentials.credentials)
    except Exception:
        return CurrentUser()
    return CurrentUser(is_admin=claims.get("is_admin", False), organizations=claims.get("organizations", []))


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return user
