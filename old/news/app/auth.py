"""Авторизация и роли.

Две роли: «админ» и «пользователь». Кто админ — определяется режимом:

- auth_mode = "open"  (по умолчанию, для разработки): роль берётся из
  настройки DEV_ROLE (admin | user). Удобно тестировать оба вида локально
  без настройки Discord.
- auth_mode = "discord": пользователь входит через Discord OAuth, мы читаем
  его роли в заданном сервере (guild) и сверяем с DISCORD_ADMIN_ROLE_ID.

Точка расширения: чтобы определять админа иначе (например, по логину
большого сайта, в который встроен сервис), достаточно переопределить
get_viewer() — всё остальное опирается только на неё.
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass

import httpx
from fastapi import Request

from app.config import settings

DISCORD_API = "https://discord.com/api"
OAUTH_SCOPES = "identify guilds.members.read"


# --- Исключения для управления редиректами --------------------------------


class LoginRequired(Exception):
    """Нужен вход. Обработчик в main.py отправит на страницу входа."""


class AdminRequired(Exception):
    """Вошёл, но не админ. Обработчик покажет страницу 403 / ленту."""


# --- Представление зрителя -------------------------------------------------


@dataclass
class Viewer:
    authenticated: bool = False
    is_admin: bool = False
    user_id: str | None = None
    username: str | None = None
    avatar_url: str | None = None

    @property
    def role_label(self) -> str:
        if self.is_admin:
            return "Админ"
        if self.authenticated:
            return "Пользователь"
        return "Гость"


def get_viewer(request: Request) -> Viewer:
    """Определяет текущего зрителя и его роль."""
    if settings.auth_mode == "discord":
        data = request.session.get("user")
        if not data:
            return Viewer()
        return Viewer(
            authenticated=True,
            is_admin=bool(data.get("is_admin")),
            user_id=data.get("id"),
            username=data.get("username"),
            avatar_url=data.get("avatar_url"),
        )

    # режим "open" (разработка): роль из DEV_ROLE
    is_admin = settings.dev_role != "user"
    return Viewer(
        authenticated=True,
        is_admin=is_admin,
        username="Локальный администратор" if is_admin else "Локальный пользователь",
    )


# --- Зависимости FastAPI ---------------------------------------------------


def require_admin(request: Request) -> Viewer:
    """Пропускает только админа. Иначе бросает исключение-редирект."""
    viewer = get_viewer(request)
    if viewer.is_admin:
        return viewer
    if not viewer.authenticated:
        raise LoginRequired()
    raise AdminRequired()


def require_feed_access(request: Request) -> Viewer:
    """Доступ к ленте. Если FEED_PUBLIC=False — требуется вход."""
    viewer = get_viewer(request)
    if settings.feed_public or viewer.authenticated:
        return viewer
    raise LoginRequired()


# --- Discord OAuth ---------------------------------------------------------


def build_authorize_url(state: str) -> str:
    """URL страницы согласия Discord."""
    params = {
        "client_id": settings.discord_client_id,
        "redirect_uri": settings.discord_redirect_uri,
        "response_type": "code",
        "scope": OAUTH_SCOPES,
        "state": state,
        "prompt": "consent",
    }
    return f"{DISCORD_API}/oauth2/authorize?" + urllib.parse.urlencode(params)


def exchange_code(code: str) -> str | None:
    """Меняет код авторизации на access_token. None — при ошибке."""
    data = {
        "client_id": settings.discord_client_id,
        "client_secret": settings.discord_client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.discord_redirect_uri,
    }
    try:
        with httpx.Client(timeout=settings.discord_timeout) as client:
            resp = client.post(f"{DISCORD_API}/oauth2/token", data=data)
            if resp.status_code != 200:
                return None
            return resp.json().get("access_token")
    except httpx.HTTPError:
        return None


def _avatar_url(user: dict) -> str | None:
    uid = user.get("id")
    avatar = user.get("avatar")
    if uid and avatar:
        ext = "gif" if str(avatar).startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{uid}/{avatar}.{ext}?size=64"
    return None


def fetch_user_and_role(access_token: str) -> dict | None:
    """По токену получает профиль и вычисляет, админ ли пользователь.

    Возвращает словарь для сессии: {id, username, avatar_url, is_admin}.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        with httpx.Client(timeout=settings.discord_timeout) as client:
            me = client.get(f"{DISCORD_API}/users/@me", headers=headers)
            if me.status_code != 200:
                return None
            user = me.json()

            # роли пользователя в нужном сервере
            is_admin = False
            member_resp = client.get(
                f"{DISCORD_API}/users/@me/guilds/"
                f"{settings.discord_guild_id}/member",
                headers=headers,
            )
            if member_resp.status_code == 200:
                roles = member_resp.json().get("roles", [])
                is_admin = settings.discord_admin_role_id in roles
    except httpx.HTTPError:
        return None

    username = user.get("global_name") or user.get("username") or "Пользователь"
    return {
        "id": str(user.get("id")),
        "username": username,
        "avatar_url": _avatar_url(user),
        "is_admin": is_admin,
    }
