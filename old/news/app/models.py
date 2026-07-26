"""ORM-модели: Tag, Webhook, News, NewsDelivery и связующие таблицы."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    pass


# --- Связующие таблицы many-to-many ---------------------------------------

webhook_tags = Table(
    "webhook_tags",
    Base.metadata,
    Column(
        "webhook_id",
        ForeignKey("webhooks.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

news_tags = Table(
    "news_tags",
    Base.metadata,
    Column(
        "news_id",
        ForeignKey("news.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


# --- Сущности --------------------------------------------------------------


class Tag(Base):
    """Тег. Связывает новости с вебхуками (маршрутизация)."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # цвет «чипа» тега в интерфейсе (опционально)
    color: Mapped[int | None] = mapped_column(Integer, nullable=True)

    webhooks: Mapped[list["Webhook"]] = relationship(
        secondary=webhook_tags,
        back_populates="tags",
    )
    news: Mapped[list["News"]] = relationship(
        secondary=news_tags,
        back_populates="tags",
    )


class Webhook(Base):
    """Discord-вебхук, привязанный к каналу, с набором тегов."""

    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(primary_key=True)
    # человекочитаемое имя, напр. «Полигон #админ»
    name: Mapped[str] = mapped_column(String(128))
    url: Mapped[str] = mapped_column(Text)
    # имя/аватар по умолчанию для этого вебхука (если в новости не задано)
    default_username: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    default_avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    tags: Mapped[list[Tag]] = relationship(
        secondary=webhook_tags,
        back_populates="webhooks",
    )


class News(Base):
    """Новость: контент + оформление эмбеда + теги."""

    __tablename__ = "news"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(256))
    content: Mapped[str] = mapped_column(Text)
    # переопределение имени/аватара отправителя (иначе берётся из вебхука)
    username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # квадратная картинка в углу эмбеда
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # большая картинка-вложение внизу эмбеда
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # цвет края эмбеда (int 0..0xFFFFFF)
    color: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "draft" | "sent"
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    tags: Mapped[list[Tag]] = relationship(
        secondary=news_tags,
        back_populates="news",
    )
    deliveries: Mapped[list["NewsDelivery"]] = relationship(
        back_populates="news",
        cascade="all, delete-orphan",
    )


class NewsDelivery(Base):
    """Запись о попытке доставки новости в конкретный вебхук."""

    __tablename__ = "news_deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    news_id: Mapped[int] = mapped_column(
        ForeignKey("news.id", ondelete="CASCADE")
    )
    # вебхук может быть удалён позже — сохраняем имя снимком
    webhook_id: Mapped[int | None] = mapped_column(
        ForeignKey("webhooks.id", ondelete="SET NULL"), nullable=True
    )
    webhook_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    discord_message_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    sent_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    news: Mapped[News] = relationship(back_populates="deliveries")
