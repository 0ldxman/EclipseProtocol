"""Pydantic-схемы (v2) для валидации и сериализации API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.utils import normalize_color


# --- Tags ------------------------------------------------------------------


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: int | str | None = None

    @field_validator("color")
    @classmethod
    def _color(cls, v):  # noqa: ANN001, ANN206
        return normalize_color(v)


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: int | None = None


# --- Webhooks --------------------------------------------------------------


class WebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=1)
    default_username: str | None = None
    default_avatar: str | None = None
    enabled: bool = True
    tag_ids: list[int] = Field(default_factory=list)


class WebhookUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    url: str | None = None
    default_username: str | None = None
    default_avatar: str | None = None
    enabled: bool | None = None
    tag_ids: list[int] | None = None


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    default_username: str | None = None
    default_avatar: str | None = None
    enabled: bool
    created_at: datetime
    tags: list[TagOut] = Field(default_factory=list)


# --- News ------------------------------------------------------------------


class NewsCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1)
    username: str | None = None
    avatar_url: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None
    color: int | str | None = None
    tag_ids: list[int] = Field(default_factory=list)
    # если True — новость сразу публикуется после создания
    send: bool = False
    # необязательный явный список вебхуков для публикации (override по тегам)
    webhook_ids: list[int] | None = None

    @field_validator("color")
    @classmethod
    def _color(cls, v):  # noqa: ANN001, ANN206
        return normalize_color(v)


class NewsUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    content: str | None = None
    username: str | None = None
    avatar_url: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None
    color: int | str | None = None
    tag_ids: list[int] | None = None

    @field_validator("color")
    @classmethod
    def _color(cls, v):  # noqa: ANN001, ANN206
        return normalize_color(v)


class NewsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    username: str | None = None
    avatar_url: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None
    color: int | None = None
    status: str
    created_at: datetime
    sent_at: datetime | None = None
    tags: list[TagOut] = Field(default_factory=list)


# --- Доставка / отправка ---------------------------------------------------


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    news_id: int
    webhook_id: int | None = None
    webhook_name: str | None = None
    success: bool
    status_code: int | None = None
    error: str | None = None
    discord_message_id: str | None = None
    sent_at: datetime


class SendRequest(BaseModel):
    """Тело запроса на отправку. webhook_ids=None — маршрутизация по тегам."""

    webhook_ids: list[int] | None = None
