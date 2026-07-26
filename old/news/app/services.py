"""Бизнес-логика: CRUD сущностей, маршрутизация по тегам, отправка."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import discord
from app.models import News, NewsDelivery, Tag, Webhook
from app.utils import clean_str, normalize_color

# Sentinel: отличает «аргумент не передан» от «передан None».
_UNSET: object = object()


# --- Tags ------------------------------------------------------------------


def list_tags(db: Session) -> list[Tag]:
    return list(db.scalars(select(Tag).order_by(Tag.name)).all())


def get_tag(db: Session, tag_id: int) -> Tag | None:
    return db.get(Tag, tag_id)


def create_tag(db: Session, name: str, color=None) -> Tag:  # noqa: ANN001
    tag = Tag(name=name.strip(), color=normalize_color(color))
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def delete_tag(db: Session, tag: Tag) -> None:
    db.delete(tag)
    db.commit()


def _tags_by_ids(db: Session, tag_ids: list[int]) -> list[Tag]:
    if not tag_ids:
        return []
    rows = db.scalars(select(Tag).where(Tag.id.in_(tag_ids))).all()
    return list(rows)


# --- Webhooks --------------------------------------------------------------


def list_webhooks(db: Session) -> list[Webhook]:
    stmt = (
        select(Webhook)
        .options(selectinload(Webhook.tags))
        .order_by(Webhook.name)
    )
    return list(db.scalars(stmt).all())


def get_webhook(db: Session, webhook_id: int) -> Webhook | None:
    stmt = (
        select(Webhook)
        .options(selectinload(Webhook.tags))
        .where(Webhook.id == webhook_id)
    )
    return db.scalars(stmt).first()


def create_webhook(
    db: Session,
    *,
    name: str,
    url: str,
    default_username=None,  # noqa: ANN001
    default_avatar=None,  # noqa: ANN001
    enabled: bool = True,
    tag_ids: list[int] | None = None,
) -> Webhook:
    webhook = Webhook(
        name=name.strip(),
        url=url.strip(),
        default_username=clean_str(default_username),
        default_avatar=clean_str(default_avatar),
        enabled=enabled,
        tags=_tags_by_ids(db, tag_ids or []),
    )
    db.add(webhook)
    db.commit()
    # перечитываем с загруженными тегами
    return get_webhook(db, webhook.id)  # type: ignore[return-value]


def update_webhook(
    db: Session,
    webhook: Webhook,
    *,
    name=_UNSET,  # noqa: ANN001
    url=_UNSET,  # noqa: ANN001
    default_username=_UNSET,  # noqa: ANN001
    default_avatar=_UNSET,  # noqa: ANN001
    enabled=_UNSET,  # noqa: ANN001
    tag_ids=_UNSET,  # noqa: ANN001
) -> Webhook:
    if name is not _UNSET and name is not None:
        webhook.name = name.strip()
    if url is not _UNSET and url is not None:
        webhook.url = url.strip()
    if default_username is not _UNSET:
        webhook.default_username = clean_str(default_username)
    if default_avatar is not _UNSET:
        webhook.default_avatar = clean_str(default_avatar)
    if enabled is not _UNSET and enabled is not None:
        webhook.enabled = bool(enabled)
    if tag_ids is not _UNSET and tag_ids is not None:
        webhook.tags = _tags_by_ids(db, tag_ids)
    db.commit()
    return get_webhook(db, webhook.id)  # type: ignore[return-value]


def delete_webhook(db: Session, webhook: Webhook) -> None:
    db.delete(webhook)
    db.commit()


# --- News ------------------------------------------------------------------


def list_news(db: Session, status: str | None = None) -> list[News]:
    stmt = select(News).options(selectinload(News.tags))
    if status:
        stmt = stmt.where(News.status == status)
    # новые сверху
    stmt = stmt.order_by(News.created_at.desc(), News.id.desc())
    return list(db.scalars(stmt).all())


def get_news(db: Session, news_id: int) -> News | None:
    stmt = (
        select(News)
        .options(selectinload(News.tags), selectinload(News.deliveries))
        .where(News.id == news_id)
    )
    return db.scalars(stmt).first()


def create_news(
    db: Session,
    *,
    title: str,
    content: str,
    username=None,  # noqa: ANN001
    avatar_url=None,  # noqa: ANN001
    thumbnail_url=None,  # noqa: ANN001
    image_url=None,  # noqa: ANN001
    color=None,  # noqa: ANN001
    tag_ids: list[int] | None = None,
) -> News:
    news = News(
        title=title.strip(),
        content=content,
        username=clean_str(username),
        avatar_url=clean_str(avatar_url),
        thumbnail_url=clean_str(thumbnail_url),
        image_url=clean_str(image_url),
        color=normalize_color(color),
        status="draft",
        tags=_tags_by_ids(db, tag_ids or []),
    )
    db.add(news)
    db.commit()
    return get_news(db, news.id)  # type: ignore[return-value]


def update_news(
    db: Session,
    news: News,
    *,
    title=_UNSET,  # noqa: ANN001
    content=_UNSET,  # noqa: ANN001
    username=_UNSET,  # noqa: ANN001
    avatar_url=_UNSET,  # noqa: ANN001
    thumbnail_url=_UNSET,  # noqa: ANN001
    image_url=_UNSET,  # noqa: ANN001
    color=_UNSET,  # noqa: ANN001
    tag_ids=_UNSET,  # noqa: ANN001
) -> News:
    if title is not _UNSET and title is not None:
        news.title = title.strip()
    if content is not _UNSET and content is not None:
        news.content = content
    if username is not _UNSET:
        news.username = clean_str(username)
    if avatar_url is not _UNSET:
        news.avatar_url = clean_str(avatar_url)
    if thumbnail_url is not _UNSET:
        news.thumbnail_url = clean_str(thumbnail_url)
    if image_url is not _UNSET:
        news.image_url = clean_str(image_url)
    if color is not _UNSET:
        news.color = normalize_color(color)
    if tag_ids is not _UNSET and tag_ids is not None:
        news.tags = _tags_by_ids(db, tag_ids)
    db.commit()
    return get_news(db, news.id)  # type: ignore[return-value]


def delete_news(db: Session, news: News) -> None:
    db.delete(news)
    db.commit()


# --- Маршрутизация и отправка ---------------------------------------------


def resolve_targets(
    db: Session,
    news: News,
    webhook_ids: list[int] | None = None,
) -> list[Webhook]:
    """Определяет, в какие вебхуки публиковать новость.

    webhook_ids is None  -> по пересечению тегов новости и вебхуков;
    webhook_ids == []    -> никуда;
    список id            -> эти вебхуки (только enabled).
    """
    if webhook_ids is not None:
        if not webhook_ids:
            return []
        stmt = (
            select(Webhook)
            .options(selectinload(Webhook.tags))
            .where(Webhook.id.in_(webhook_ids), Webhook.enabled.is_(True))
        )
        return list(db.scalars(stmt).all())

    # маршрутизация по тегам
    tag_ids = [t.id for t in news.tags]
    if not tag_ids:
        return []
    stmt = (
        select(Webhook)
        .options(selectinload(Webhook.tags))
        .join(Webhook.tags)
        .where(Tag.id.in_(tag_ids), Webhook.enabled.is_(True))
        .distinct()
        .order_by(Webhook.name)
    )
    return list(db.scalars(stmt).all())


def matched_webhook_ids(db: Session, news: News) -> set[int]:
    """ID вебхуков, подходящих новости по тегам (для предзаполнения формы)."""
    return {w.id for w in resolve_targets(db, news, webhook_ids=None)}


def send_news(
    db: Session,
    news: News,
    webhook_ids: list[int] | None = None,
) -> list[NewsDelivery]:
    """Публикует новость в подходящие вебхуки и фиксирует доставки."""
    targets = resolve_targets(db, news, webhook_ids=webhook_ids)
    tag_names = [t.name for t in news.tags]

    deliveries: list[NewsDelivery] = []
    any_success = False

    for webhook in targets:
        payload = discord.build_payload(news, webhook, tag_names)
        result = discord.send_payload(webhook.url, payload)

        delivery = NewsDelivery(
            news_id=news.id,
            webhook_id=webhook.id,
            webhook_name=webhook.name,
            success=result.success,
            status_code=result.status_code,
            error=result.error,
            discord_message_id=result.message_id,
        )
        db.add(delivery)
        deliveries.append(delivery)
        any_success = any_success or result.success

    # помечаем отправленной, если хотя бы одна доставка успешна
    if any_success and news.status != "sent":
        news.status = "sent"
        news.sent_at = datetime.now(timezone.utc)

    db.commit()
    for d in deliveries:
        db.refresh(d)
    return deliveries


# --- Публичная лента (только опубликованные новости) -----------------------


def list_published(db: Session, tag_id: int | None = None) -> list[News]:
    """Опубликованные новости (status='sent'), новые сверху.

    tag_id — необязательный фильтр по тегу-категории.
    """
    from sqlalchemy import func

    stmt = (
        select(News)
        .options(selectinload(News.tags))
        .where(News.status == "sent")
    )
    if tag_id is not None:
        stmt = stmt.join(News.tags).where(Tag.id == tag_id)
    stmt = stmt.order_by(
        func.coalesce(News.sent_at, News.created_at).desc(), News.id.desc()
    )
    return list(db.scalars(stmt).all())


def get_published(db: Session, news_id: int) -> News | None:
    """Одна опубликованная новость для страницы статьи."""
    stmt = (
        select(News)
        .options(selectinload(News.tags))
        .where(News.id == news_id, News.status == "sent")
    )
    return db.scalars(stmt).first()


def tags_with_published(db: Session) -> list[Tag]:
    """Теги, у которых есть хотя бы одна опубликованная новость."""
    stmt = (
        select(Tag)
        .join(Tag.news)
        .where(News.status == "sent")
        .distinct()
        .order_by(Tag.name)
    )
    return list(db.scalars(stmt).all())


def publish_news(db: Session, news: News) -> News:
    """Публикует новость в ленту сайта (без отправки в Discord)."""
    if news.status != "sent":
        news.status = "sent"
        if news.sent_at is None:
            news.sent_at = datetime.now(timezone.utc)
        db.commit()
    return news


def unpublish_news(db: Session, news: News) -> News:
    """Снимает новость с публикации (возвращает в черновики)."""
    if news.status != "draft":
        news.status = "draft"
        db.commit()
    return news
