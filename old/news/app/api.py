"""REST API: теги, вебхуки, новости, отправка.

Все эндпоинты под /api и защищены проверкой API-ключа (если он задан).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import services
from app.database import get_db
from app.deps import require_api_key
from app.schemas import (
    DeliveryOut,
    NewsCreate,
    NewsOut,
    NewsUpdate,
    SendRequest,
    TagCreate,
    TagOut,
    WebhookCreate,
    WebhookOut,
    WebhookUpdate,
)

router = APIRouter(prefix="/api", dependencies=[Depends(require_api_key)])


# --- Tags ------------------------------------------------------------------


@router.get("/tags", response_model=list[TagOut])
def api_list_tags(db: Session = Depends(get_db)):
    return services.list_tags(db)


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def api_create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    return services.create_tag(db, name=payload.name, color=payload.color)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = services.get_tag(db, tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тег не найден")
    services.delete_tag(db, tag)


# --- Webhooks --------------------------------------------------------------


@router.get("/webhooks", response_model=list[WebhookOut])
def api_list_webhooks(db: Session = Depends(get_db)):
    return services.list_webhooks(db)


@router.post(
    "/webhooks",
    response_model=WebhookOut,
    status_code=status.HTTP_201_CREATED,
)
def api_create_webhook(payload: WebhookCreate, db: Session = Depends(get_db)):
    return services.create_webhook(
        db,
        name=payload.name,
        url=payload.url,
        default_username=payload.default_username,
        default_avatar=payload.default_avatar,
        enabled=payload.enabled,
        tag_ids=payload.tag_ids,
    )


@router.get("/webhooks/{webhook_id}", response_model=WebhookOut)
def api_get_webhook(webhook_id: int, db: Session = Depends(get_db)):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вебхук не найден")
    return webhook


@router.patch("/webhooks/{webhook_id}", response_model=WebhookOut)
def api_update_webhook(
    webhook_id: int, payload: WebhookUpdate, db: Session = Depends(get_db)
):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вебхук не найден")
    data = payload.model_dump(exclude_unset=True)
    return services.update_webhook(db, webhook, **data)


@router.delete(
    "/webhooks/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT
)
def api_delete_webhook(webhook_id: int, db: Session = Depends(get_db)):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вебхук не найден")
    services.delete_webhook(db, webhook)


# --- News ------------------------------------------------------------------


@router.get("/news", response_model=list[NewsOut])
def api_list_news(status: str | None = None, db: Session = Depends(get_db)):
    return services.list_news(db, status=status)


@router.post("/news", response_model=NewsOut, status_code=status.HTTP_201_CREATED)
def api_create_news(payload: NewsCreate, db: Session = Depends(get_db)):
    news = services.create_news(
        db,
        title=payload.title,
        content=payload.content,
        username=payload.username,
        avatar_url=payload.avatar_url,
        thumbnail_url=payload.thumbnail_url,
        image_url=payload.image_url,
        color=payload.color,
        tag_ids=payload.tag_ids,
    )
    if payload.send:
        services.send_news(db, news, webhook_ids=payload.webhook_ids)
        news = services.get_news(db, news.id)
    return news


@router.get("/news/{news_id}", response_model=NewsOut)
def api_get_news(news_id: int, db: Session = Depends(get_db)):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    return news


@router.patch("/news/{news_id}", response_model=NewsOut)
def api_update_news(
    news_id: int, payload: NewsUpdate, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    data = payload.model_dump(exclude_unset=True)
    return services.update_news(db, news, **data)


@router.delete("/news/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_news(news_id: int, db: Session = Depends(get_db)):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    services.delete_news(db, news)


@router.post("/news/{news_id}/send", response_model=list[DeliveryOut])
def api_send_news(
    news_id: int,
    payload: SendRequest | None = None,
    db: Session = Depends(get_db),
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    webhook_ids = payload.webhook_ids if payload else None
    return services.send_news(db, news, webhook_ids=webhook_ids)
