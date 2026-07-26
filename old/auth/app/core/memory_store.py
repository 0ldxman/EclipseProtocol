"""In-process refresh-session store: a dict with TTLs, guarded by a lock.

Single-process only by design (matches running this service as one
`uvicorn` worker on one machine) - no Redis needed at this scale. Sessions
are lost on restart and not shared across processes; if the service is ever
scaled to multiple workers/instances, swap this module for a shared store.
"""

import secrets
import threading
import time

from app.core.config import Settings

_lock = threading.Lock()
_sessions: dict[str, tuple[dict, float]] = {}


def _purge_expired(now: float) -> None:
    expired = [token for token, (_, expires_at) in _sessions.items() if expires_at <= now]
    for token in expired:
        del _sessions[token]


def create_refresh_session(
    settings: Settings, *, discord_id: str, username: str, is_admin: bool, organizations: list
) -> str:
    token = secrets.token_urlsafe(48)
    session = {
        "discord_id": discord_id,
        "username": username,
        "is_admin": is_admin,
        "organizations": organizations,
    }
    expires_at = time.time() + settings.refresh_token_ttl_seconds
    with _lock:
        _purge_expired(time.time())
        _sessions[token] = (session, expires_at)
    return token


def get_refresh_session(token: str) -> dict | None:
    with _lock:
        entry = _sessions.get(token)
        if entry is None:
            return None
        session, expires_at = entry
        if expires_at <= time.time():
            del _sessions[token]
            return None
        return session


def rotate_refresh_session(settings: Settings, old_token: str) -> tuple[str, dict] | None:
    with _lock:
        entry = _sessions.pop(old_token, None)
        if entry is None:
            return None
        session, expires_at = entry
        if expires_at <= time.time():
            return None
        new_token = secrets.token_urlsafe(48)
        _sessions[new_token] = (session, time.time() + settings.refresh_token_ttl_seconds)
        return new_token, session


def revoke_refresh_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)
