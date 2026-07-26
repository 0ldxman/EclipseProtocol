from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from app.admin.routes import router as admin_router
from app.auth.routes import router as auth_router
from app.core.config import Settings, get_settings
from app.core.security import public_key_pem
from app.db import close_db, init_db


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings = get_settings()
    await init_db(settings)
    yield
    await close_db(settings)


app = FastAPI(
    title="aether-auth",
    description="Discord-backed authorization service",
    lifespan=_lifespan,
)

_settings = get_settings()
if _settings.cors_origin_list:
    # Нужен, когда фронт (например админка) живёт на ДРУГОМ домене, а не
    # за тем же reverse-proxy/rewrite, что и этот сервис — браузер тогда
    # делает настоящий cross-site fetch с credentials.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth_router)
app.include_router(admin_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/.well-known/jwt-public-key")
async def jwt_public_key(settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    """PEM-encoded RS256 public key Wiki/Command Center use to verify access tokens."""
    return Response(content=public_key_pem(settings), media_type="application/x-pem-file")
