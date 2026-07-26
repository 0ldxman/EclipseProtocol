import secrets
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.auth.schemas import MeResponse, PasswordLoginIn, TokenResponse
from app.clients import discord
from app.core.config import Settings, get_settings
from app.core.memory_store import (
    create_refresh_session,
    revoke_refresh_session,
    rotate_refresh_session,
)
from app.core.security import decode_access_token, issue_access_token
from app.db import get_conn
from app.roles import AccessResult, OrgAccess, resolve_access

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)

REFRESH_COOKIE_NAME = "refresh_token"
STATE_MAX_AGE_SECONDS = 10 * 60


def _state_serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.oauth_state_secret, salt="discord-oauth-state")


def _set_refresh_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.refresh_token_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        # path="/" — чтобы кука переживала доступ через reverse-proxy с префиксом
        # (например code-server /proxy/<port>/auth/...), а не только голый /auth.
        path="/",
    )


def _origin_allowed(url: str, settings: Settings) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    origin = f"{parts.scheme}://{parts.netloc}"
    return origin in settings.allowed_return_origin_list


def _access_from_session(session: dict) -> AccessResult:
    return AccessResult(
        is_admin=session["is_admin"],
        organizations=[OrgAccess(**org) for org in session["organizations"]],
    )


def _token_response(settings: Settings, *, discord_id: str, username: str, access: AccessResult) -> TokenResponse:
    access_token = issue_access_token(settings, discord_id=discord_id, username=username, access=access)
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.access_token_ttl_seconds,
        discord_id=discord_id,
        username=username,
        is_admin=access.is_admin,
        organizations=[
            {
                "tag": o.organization_tag,
                "name": o.organization_name,
                "level": o.level,
                "label": o.label,
                "permissions": o.permissions,
            }
            for o in access.organizations
        ],
    )


@router.get("/login")
async def login(
    settings: Annotated[Settings, Depends(get_settings)],
    return_to: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """Каждый сайт (вики/карта/новости/админка) шлёт сюда своих гостей с
    ?return_to=<свой публичный URL>, чтобы /auth/callback знал, куда вернуть
    браузер после Discord. return_to сверяется с allowed_return_origin_list —
    без этого это был бы open redirect.
    """
    if return_to is not None and not _origin_allowed(return_to, settings):
        return_to = None
    state = _state_serializer(settings).dumps({"return_to": return_to})
    return RedirectResponse(discord.build_authorize_url(settings, state))


@router.post("/login-password", response_model=TokenResponse)
async def login_password(
    body: PasswordLoginIn,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    """Локальный одно-операторный вход в админку по паролю (ADMIN_PASSWORD).

    Выдаёт admin-токен без организаций и ставит refresh-куку, чтобы сессия
    переживала перезагрузку страницы через обычный /auth/refresh.
    """
    if not settings.admin_password:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "password login is not configured")
    if not secrets.compare_digest(body.password, settings.admin_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid password")

    access = AccessResult(is_admin=True, organizations=[])
    refresh_token = create_refresh_session(
        settings,
        discord_id="local-admin",
        username="admin",
        is_admin=True,
        organizations=[],
    )
    _set_refresh_cookie(response, settings, refresh_token)
    return _token_response(settings, discord_id="local-admin", username="admin", access=access)


@router.get("/callback", response_model=None)
async def callback(
    code: str,
    state: str,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse | RedirectResponse:
    try:
        state_data = _state_serializer(settings).loads(state, max_age=STATE_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired state")

    # return_to уже проверялся на /auth/login, но он пришёл через подписанный
    # state, так что перепроверка тут — просто defense-in-depth, не доверие к
    # state как таковому.
    return_to = state_data.get("return_to")
    if return_to is not None and not _origin_allowed(return_to, settings):
        return_to = None

    try:
        discord_token = await discord.exchange_code_for_token(settings, code)
        user = await discord.fetch_user(discord_token)
        member = await discord.fetch_guild_member(discord_token, settings.discord_guild_id)
    except discord.DiscordOAuthError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    if not member.in_guild:
        access = AccessResult(False, [])
    else:
        async with get_conn(settings) as conn:
            access = await resolve_access(conn, member.role_ids)

    refresh_token = create_refresh_session(
        settings,
        discord_id=user.id,
        username=user.username,
        is_admin=access.is_admin,
        organizations=[
            {
                "organization_tag": o.organization_tag,
                "organization_name": o.organization_name,
                "level": o.level,
                "label": o.label,
                "permissions": o.permissions,
            }
            for o in access.organizations
        ],
    )

    target = return_to or settings.admin_url
    if target:
        # Кука должна быть установлена на ТОТ объект Response, который реально
        # уходит клиенту — куки/заголовки, выставленные на инжектированный
        # `response`, FastAPI игнорирует, если функция вернула Response сама.
        redirect = RedirectResponse(target)
        _set_refresh_cookie(redirect, settings, refresh_token)
        return redirect

    _set_refresh_cookie(response, settings, refresh_token)
    return _token_response(settings, discord_id=user.id, username=user.username, access=access)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> TokenResponse:
    if refresh_token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing refresh token")

    rotated = rotate_refresh_session(settings, refresh_token)
    if rotated is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired refresh token")
    new_refresh_token, session = rotated
    _set_refresh_cookie(response, settings, new_refresh_token)

    access = _access_from_session(session)
    return _token_response(settings, discord_id=session["discord_id"], username=session["username"], access=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> None:
    if refresh_token is not None:
        revoke_refresh_session(refresh_token)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/", domain=settings.cookie_domain)


@router.get("/me", response_model=MeResponse)
async def me(
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> MeResponse:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        claims = decode_access_token(settings, credentials.credentials)
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from exc

    return MeResponse(
        discord_id=claims["sub"],
        username=claims["username"],
        is_admin=claims["is_admin"],
        organizations=claims["organizations"],
    )
