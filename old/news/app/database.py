"""Настройка базы данных: движок, фабрика сессий, инициализация схемы."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# Для SQLite в многопоточном FastAPI нужен check_same_thread=False:
# синхронные роуты выполняются в threadpool.
_connect_args = {}
if settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    future=True,
)

# expire_on_commit=False — объекты остаются пригодными к чтению после commit,
# в т.ч. при сериализации ответа FastAPI и рендере шаблонов.
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
    future=True,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ANN001
    """Включаем контроль внешних ключей в SQLite (по умолчанию выключен)."""
    # Срабатывает для любого движка; проверяем, что это SQLite-соединение.
    module_name = type(dbapi_connection).__module__.lower()
    if "sqlite" in module_name:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db() -> Iterator[Session]:
    """Зависимость FastAPI: открывает сессию и гарантированно закрывает её."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Создаёт таблицы, если их ещё нет."""
    # импорт здесь, чтобы модели зарегистрировались в metadata
    from app import models  # noqa: F401

    models.Base.metadata.create_all(bind=engine)
