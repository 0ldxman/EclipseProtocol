from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Discord OAuth2 app credentials (Discord Developer Portal).
    discord_client_id: str
    discord_client_secret: str
    discord_redirect_uri: str

    # The single guild that defines org membership/roles.
    discord_guild_id: str

    # RS256 keypair used to sign/verify the JWTs trusted by Wiki/Command Center.
    jwt_private_key_path: str = "keys/private.pem"
    jwt_public_key_path: str = "keys/public.pem"
    jwt_issuer: str = "aether-auth"
    jwt_audience: str = "aether-services"
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_seconds: int = 30 * 24 * 60 * 60

    # Organizations/roles/permissions/admin-roles live here, editable at runtime
    # through the admin API/UI without restarting the service.
    database_path: str = "aether_auth.db"

    # Signs the OAuth2 "state" param so callbacks can't be forged.
    oauth_state_secret: str

    cookie_domain: str | None = None
    cookie_secure: bool = True
    # "lax" работает, когда фронт и auth на одном origin (локально — через
    # rewrites Next.js). Когда фронт и auth на РАЗНЫХ доменах (как в проде:
    # admin.aether.0x.no и auth.aether.icu.sh) — нужно "none" (требует
    # cookie_secure=true, иначе браузер откажется ставить такую куку).
    cookie_samesite: str = "lax"

    # Запасной URL для /auth/callback, когда /auth/login был вызван без
    # ?return_to (например, старые ссылки/закладки на сам /auth/login).
    admin_url: str | None = None

    # Разрешённые CORS-origin'ы (через запятую) для браузерных запросов с
    # ДРУГОГО домена (нужно, когда фронт — отдельный домен, а не за тем же
    # reverse-proxy/rewrite, что и auth).
    cors_origins: str = ""

    # Белый список origin'ов, на которые /auth/callback разрешено редиректить
    # через ?return_to у /auth/login (вики/карта/новости/админка — у каждой
    # свой домен). Без этой проверки return_to был бы open redirect.
    allowed_return_origins: str = ""

    # Локальный одно-операторный вход в админку по паролю (без Discord).
    # Если задан — доступен POST /auth/login-password, выдающий admin-токен.
    admin_password: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_return_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_return_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
