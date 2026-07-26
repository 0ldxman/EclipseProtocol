"""Конфигурация сервиса.

Все настройки берутся из переменных окружения. Дополнительно поддерживается
загрузка из файла .env (простым парсером, без зависимости python-dotenv).
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

# Корень проекта (папка, где лежит run.py и .env)
BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Минимальный парсер .env: KEY=VALUE построчно."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")


def _get_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on", "да"}


class Settings:
    """Настройки приложения."""

    def __init__(self) -> None:
        # --- База -----------------------------------------------------------
        self.database_url: str = os.environ.get(
            "DATABASE_URL", f"sqlite:///{BASE_DIR / 'news.db'}"
        )

        # --- API ------------------------------------------------------------
        # Ключ для API (заголовок X-API-Key). Пусто -> API открыт.
        self.api_key: str = os.environ.get("NEWS_API_KEY", "").strip()

        # --- Доступ / роли --------------------------------------------------
        # Режим авторизации: "open" (dev, все админы) или "discord" (по ролям).
        self.auth_mode: str = os.environ.get("AUTH_MODE", "open").strip().lower()

        # В режиме "open" можно форсировать роль для тестов: "admin" | "user".
        self.dev_role: str = os.environ.get("DEV_ROLE", "admin").strip().lower()

        # Доступна ли лента анонимным посетителям (без входа).
        self.feed_public: bool = _get_bool("FEED_PUBLIC", True)

        # Секрет для подписи cookie-сессий. Если не задан — случайный на запуск
        # (для прода обязательно задайте постоянный, иначе сессии сбрасываются).
        self.session_secret: str = os.environ.get(
            "SESSION_SECRET", ""
        ).strip() or secrets.token_hex(32)

        # --- Discord OAuth (для auth_mode=discord) --------------------------
        self.discord_client_id: str = os.environ.get(
            "DISCORD_CLIENT_ID", ""
        ).strip()
        self.discord_client_secret: str = os.environ.get(
            "DISCORD_CLIENT_SECRET", ""
        ).strip()
        self.discord_guild_id: str = os.environ.get(
            "DISCORD_GUILD_ID", ""
        ).strip()
        self.discord_admin_role_id: str = os.environ.get(
            "DISCORD_ADMIN_ROLE_ID", ""
        ).strip()
        self.discord_redirect_uri: str = os.environ.get(
            "DISCORD_REDIRECT_URI", "http://127.0.0.1:8000/auth/callback"
        ).strip()

        # --- Discord (отправка новостей) ------------------------------------
        try:
            self.discord_timeout: float = float(
                os.environ.get("DISCORD_TIMEOUT", "10")
            )
        except ValueError:
            self.discord_timeout = 10.0

        # --- Прочее ---------------------------------------------------------
        self.app_title: str = os.environ.get("APP_TITLE", "Центр новостей")

    @property
    def api_auth_enabled(self) -> bool:
        return bool(self.api_key)

    @property
    def discord_oauth_configured(self) -> bool:
        return bool(
            self.discord_client_id
            and self.discord_client_secret
            and self.discord_guild_id
            and self.discord_admin_role_id
        )


settings = Settings()
