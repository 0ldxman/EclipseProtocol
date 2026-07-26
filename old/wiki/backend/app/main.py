from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.categories.routes import router as categories_router
from app.core.config import get_settings
from app.core.security import load_public_key
from app.db import close_db, init_db
from app.records.routes import router as records_router
from app.timeline.routes import router as timeline_router


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings = get_settings()
    await init_db(settings)
    await load_public_key(settings)
    yield
    await close_db(settings)


app = FastAPI(
    title="aether-wiki",
    description="Lore wiki for the aether ecosystem: org-scoped read access via aether-auth JWTs",
    lifespan=_lifespan,
)
app.include_router(records_router)
app.include_router(categories_router)
app.include_router(timeline_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
