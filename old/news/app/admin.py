"""Админ-панель (server-rendered HTML).

Маршруты под /admin защищены Basic-доступом (если задан пароль).
Формы отправляются обычным POST (application/x-www-form-urlencoded).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import services
from app.auth import get_viewer, require_admin
from app.database import get_db
from app.templating import templates

router = APIRouter(
    prefix="/admin",
    dependencies=[Depends(require_admin)],
    include_in_schema=False,
)


def render(request: Request, template: str, active: str, **extra):
    """Рендер шаблона с актуальной сигнатурой Starlette (request первым).

    request кладём и в контекст — шаблоны/Jinja могут на него опираться.
    viewer — текущий админ (для шапки: роль, имя, выход).
    """
    context = {
        "request": request,
        "active": active,
        "viewer": get_viewer(request),
        **extra,
    }
    return templates.TemplateResponse(request, template, context)


def _redirect(url: str) -> RedirectResponse:
    # 303 -> браузер выполнит GET после POST
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


# --- Новости ---------------------------------------------------------------


@router.get("", response_class=HTMLResponse)
def admin_root(request: Request):
    return _redirect("/admin/news")


@router.get("/news", response_class=HTMLResponse)
def admin_news_list(request: Request, db: Session = Depends(get_db)):
    drafts = services.list_news(db, status="draft")
    sent = services.list_news(db, status="sent")
    return render(request, "news_list.html", "news", drafts=drafts, sent=sent)


@router.get("/news/new", response_class=HTMLResponse)
def admin_news_new(request: Request, db: Session = Depends(get_db)):
    tags = services.list_tags(db)
    return render(
        request,
        "news_form.html",
        "news",
        news=None,
        tags=tags,
        selected_tag_ids=set(),
    )


@router.post("/news", response_class=HTMLResponse)
def admin_news_create(
    request: Request,
    db: Session = Depends(get_db),
    title: str = Form(...),
    content: str = Form(...),
    username: str = Form(default=""),
    avatar_url: str = Form(default=""),
    thumbnail_url: str = Form(default=""),
    image_url: str = Form(default=""),
    color: str = Form(default="#5865F2"),
    tags: list[int] = Form(default=[]),
    action: str = Form(default="save"),
):
    news = services.create_news(
        db,
        title=title,
        content=content,
        username=username,
        avatar_url=avatar_url,
        thumbnail_url=thumbnail_url,
        image_url=image_url,
        color=color,
        tag_ids=tags,
    )
    if action == "save_and_send":
        # публикация по тегам новости
        services.send_news(db, news, webhook_ids=None)
    return _redirect("/admin/news")


@router.get("/news/{news_id}/edit", response_class=HTMLResponse)
def admin_news_edit(
    news_id: int, request: Request, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    tags = services.list_tags(db)
    return render(
        request,
        "news_form.html",
        "news",
        news=news,
        tags=tags,
        selected_tag_ids={t.id for t in news.tags},
    )


@router.post("/news/{news_id}", response_class=HTMLResponse)
def admin_news_update(
    news_id: int,
    request: Request,
    db: Session = Depends(get_db),
    title: str = Form(...),
    content: str = Form(...),
    username: str = Form(default=""),
    avatar_url: str = Form(default=""),
    thumbnail_url: str = Form(default=""),
    image_url: str = Form(default=""),
    color: str = Form(default="#5865F2"),
    tags: list[int] = Form(default=[]),
    action: str = Form(default="save"),
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    news = services.update_news(
        db,
        news,
        title=title,
        content=content,
        username=username,
        avatar_url=avatar_url,
        thumbnail_url=thumbnail_url,
        image_url=image_url,
        color=color,
        tag_ids=tags,
    )
    if action == "save_and_send":
        services.send_news(db, news, webhook_ids=None)
    return _redirect("/admin/news")


@router.post("/news/{news_id}/delete", response_class=HTMLResponse)
def admin_news_delete(
    news_id: int, request: Request, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is not None:
        services.delete_news(db, news)
    return _redirect("/admin/news")


@router.post("/news/{news_id}/publish", response_class=HTMLResponse)
def admin_news_publish(
    news_id: int, request: Request, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is not None:
        services.publish_news(db, news)
    return _redirect("/admin/news")


@router.post("/news/{news_id}/unpublish", response_class=HTMLResponse)
def admin_news_unpublish(
    news_id: int, request: Request, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is not None:
        services.unpublish_news(db, news)
    return _redirect("/admin/news")


@router.get("/news/{news_id}/send", response_class=HTMLResponse)
def admin_news_send_page(
    news_id: int, request: Request, db: Session = Depends(get_db)
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    webhooks = services.list_webhooks(db)
    matched = services.matched_webhook_ids(db, news)
    return render(
        request,
        "news_send.html",
        "news",
        news=news,
        webhooks=webhooks,
        matched_ids=matched,
    )


@router.post("/news/{news_id}/send", response_class=HTMLResponse)
def admin_news_send(
    news_id: int,
    request: Request,
    db: Session = Depends(get_db),
    webhooks: list[int] = Form(default=[]),
):
    news = services.get_news(db, news_id)
    if news is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Новость не найдена")
    # явный выбор вебхуков (override маршрутизации по тегам)
    services.send_news(db, news, webhook_ids=webhooks)
    return _redirect("/admin/news")


# --- Вебхуки ---------------------------------------------------------------


@router.get("/webhooks", response_class=HTMLResponse)
def admin_webhooks(request: Request, db: Session = Depends(get_db)):
    webhooks = services.list_webhooks(db)
    tags = services.list_tags(db)
    return render(request, "webhooks.html", "webhooks", webhooks=webhooks, tags=tags)


@router.post("/webhooks", response_class=HTMLResponse)
def admin_webhooks_create(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    url: str = Form(...),
    default_username: str = Form(default=""),
    default_avatar: str = Form(default=""),
    enabled: str | None = Form(default=None),
    tags: list[int] = Form(default=[]),
):
    services.create_webhook(
        db,
        name=name,
        url=url,
        default_username=default_username,
        default_avatar=default_avatar,
        enabled=enabled is not None,
        tag_ids=tags,
    )
    return _redirect("/admin/webhooks")


@router.get("/webhooks/{webhook_id}/edit", response_class=HTMLResponse)
def admin_webhook_edit(
    webhook_id: int, request: Request, db: Session = Depends(get_db)
):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вебхук не найден")
    tags = services.list_tags(db)
    return render(
        request,
        "webhook_form.html",
        "webhooks",
        webhook=webhook,
        tags=tags,
        selected_tag_ids={t.id for t in webhook.tags},
    )


@router.post("/webhooks/{webhook_id}", response_class=HTMLResponse)
def admin_webhook_update(
    webhook_id: int,
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    url: str = Form(...),
    default_username: str = Form(default=""),
    default_avatar: str = Form(default=""),
    enabled: str | None = Form(default=None),
    tags: list[int] = Form(default=[]),
):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вебхук не найден")
    services.update_webhook(
        db,
        webhook,
        name=name,
        url=url,
        default_username=default_username,
        default_avatar=default_avatar,
        enabled=enabled is not None,
        tag_ids=tags,
    )
    return _redirect("/admin/webhooks")


@router.post("/webhooks/{webhook_id}/delete", response_class=HTMLResponse)
def admin_webhook_delete(
    webhook_id: int, request: Request, db: Session = Depends(get_db)
):
    webhook = services.get_webhook(db, webhook_id)
    if webhook is not None:
        services.delete_webhook(db, webhook)
    return _redirect("/admin/webhooks")


# --- Теги ------------------------------------------------------------------


@router.get("/tags", response_class=HTMLResponse)
def admin_tags(request: Request, db: Session = Depends(get_db)):
    tags = services.list_tags(db)
    return render(request, "tags.html", "tags", tags=tags)


@router.post("/tags", response_class=HTMLResponse)
def admin_tags_create(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    color: str = Form(default="#5865F2"),
):
    if name.strip():
        services.create_tag(db, name=name, color=color)
    return _redirect("/admin/tags")


@router.post("/tags/{tag_id}/delete", response_class=HTMLResponse)
def admin_tags_delete(
    tag_id: int, request: Request, db: Session = Depends(get_db)
):
    tag = services.get_tag(db, tag_id)
    if tag is not None:
        services.delete_tag(db, tag)
    return _redirect("/admin/tags")
