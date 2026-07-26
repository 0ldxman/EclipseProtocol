"""Публичная часть: лента новостей и вход через Discord.

Лента (/) стилизована под новостной агрегатор и доступна роли «пользователь»
(и анонимам, если FEED_PUBLIC=True). Полное управление — в админке (/admin).
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import auth, services
from app.auth import Viewer, require_feed_access
from app.config import settings
from app.database import get_db
from app.templating import templates

router = APIRouter(include_in_schema=False)


def render(request: Request, template: str, viewer: Viewer, **extra):
    context = {"request": request, "viewer": viewer, **extra}
    return templates.TemplateResponse(request, template, context)


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=303)


# --- Лента -----------------------------------------------------------------


@router.get("/", response_class=HTMLResponse)
def feed(
    request: Request,
    tag: int | None = None,
    db: Session = Depends(get_db),
    viewer: Viewer = Depends(require_feed_access),
):
    items = services.list_published(db, tag_id=tag)
    categories = services.tags_with_published(db)
    active_tag = next((t for t in categories if t.id == tag), None)

    lead = items[0] if items else None
    rest = items[1:] if len(items) > 1 else []

    return render(
        request,
        "feed.html",
        viewer,
        lead=lead,
        rest=rest,
        categories=categories,
        active_tag=active_tag,
    )


@router.get("/article/{news_id}", response_class=HTMLResponse)
def article(
    news_id: int,
    request: Request,
    db: Session = Depends(get_db),
    viewer: Viewer = Depends(require_feed_access),
):
    news = services.get_published(db, news_id)
    if news is None:
        # неопубликованную/несуществующую статью наружу не показываем
        return render(request, "not_found.html", viewer)
    return render(request, "article.html", viewer, news=news)


# --- Вход / выход (Discord OAuth) -----------------------------------------


@router.get("/login", response_class=HTMLResponse)
def login(request: Request):
    viewer = auth.get_viewer(request)

    # в dev-режиме вход не нужен — роль берётся из настроек
    if settings.auth_mode != "discord":
        return _redirect("/")

    if viewer.is_admin:
        return _redirect("/admin")
    if viewer.authenticated:
        return _redirect("/")

    if not settings.discord_oauth_configured:
        return render(
            request,
            "login.html",
            viewer,
            error="Вход через Discord не настроен. Заполните переменные "
            "DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, "
            "DISCORD_ADMIN_ROLE_ID в .env.",
        )

    state = secrets.token_urlsafe(24)
    request.session["oauth_state"] = state
    return _redirect(auth.build_authorize_url(state))


@router.get("/auth/callback", response_class=HTMLResponse)
def auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    viewer = auth.get_viewer(request)
    expected = request.session.pop("oauth_state", None)

    if error:
        return render(
            request, "login.html", viewer,
            error=f"Discord вернул ошибку: {error}",
        )
    if not code or not state or state != expected:
        return render(
            request, "login.html", viewer,
            error="Сессия входа недействительна. Попробуйте ещё раз.",
        )

    token = auth.exchange_code(code)
    if not token:
        return render(
            request, "login.html", viewer,
            error="Не удалось обменять код на токен. Проверьте настройки "
            "приложения Discord и Redirect URL.",
        )

    user = auth.fetch_user_and_role(token)
    if not user:
        return render(
            request, "login.html", viewer,
            error="Не удалось получить профиль Discord.",
        )

    request.session["user"] = user
    return _redirect("/admin" if user.get("is_admin") else "/")


@router.get("/logout", response_class=HTMLResponse)
def logout(request: Request):
    request.session.pop("user", None)
    request.session.pop("oauth_state", None)
    return _redirect("/")
