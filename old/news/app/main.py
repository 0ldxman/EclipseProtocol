"""Точка входа FastAPI-приложения."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.admin import router as admin_router
from app.api import router as api_router
from app.auth import AdminRequired, LoginRequired, get_viewer
from app.config import settings
from app.database import init_db
from app.public import router as public_router
from app.templating import templates

_STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_title, lifespan=lifespan)

# Подписанные cookie-сессии (для входа через Discord).
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret)

app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

app.include_router(api_router)      # /api/...
app.include_router(admin_router)    # /admin/...
app.include_router(public_router)   # /, /article/{id}, /login, /logout


# --- Обработчики ролей ------------------------------------------------------


@app.exception_handler(LoginRequired)
async def _login_required(request: Request, exc: LoginRequired):
    # не вошёл — отправляем на страницу входа
    return RedirectResponse("/login", status_code=303)


@app.exception_handler(AdminRequired)
async def _admin_required(request: Request, exc: AdminRequired):
    # вошёл, но не админ — показываем 403 со ссылкой на ленту
    return templates.TemplateResponse(
        request,
        "forbidden.html",
        {"request": request, "viewer": get_viewer(request)},
        status_code=403,
    )
