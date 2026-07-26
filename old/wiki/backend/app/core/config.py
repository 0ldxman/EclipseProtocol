from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_path: str = "aether_wiki.db"

    # aether-auth publishes its RS256 public key here; fetched once at
    # startup and cached, so verifying a token never calls back to auth.
    auth_jwt_public_key_url: str
    jwt_issuer: str = "aether-auth"
    jwt_audience: str = "aether-services"


@lru_cache
def get_settings() -> Settings:
    return Settings()
