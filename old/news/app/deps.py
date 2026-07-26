"""Зависимости авторизации для API.

Проверка API-ключа опциональна: если NEWS_API_KEY не задан, API открыт
(удобно на localhost). Доступ к админке и роли вынесены в app/auth.py.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from app.config import settings


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Проверяет заголовок X-API-Key, если ключ настроен."""
    if not settings.api_auth_enabled:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или отсутствующий API-ключ",
        )
