"""Интеграция с Discord: сборка эмбеда и отправка payload в вебхук."""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.config import settings

# Лимиты Discord (символы) — обрезаем, чтобы не получить 400.
TITLE_LIMIT = 256
DESC_LIMIT = 4096
FOOTER_LIMIT = 2048
USERNAME_LIMIT = 80


@dataclass
class SendResult:
    """Результат одной отправки в вебхук."""

    success: bool
    status_code: int | None = None
    error: str | None = None
    message_id: str | None = None


def _truncate(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_embed(news, tag_names: list[str] | None = None) -> dict:
    """Собирает объект embed из новости.

    news — ORM-объект News (или совместимый по атрибутам).
    """
    embed: dict = {}

    title = _truncate(news.title, TITLE_LIMIT)
    if title:
        embed["title"] = title

    description = _truncate(news.content, DESC_LIMIT)
    if description:
        embed["description"] = description

    if news.color is not None:
        embed["color"] = int(news.color)

    if news.thumbnail_url:
        embed["thumbnail"] = {"url": news.thumbnail_url}

    if news.image_url:
        embed["image"] = {"url": news.image_url}

    # теги выводим в подвале эмбеда
    if tag_names:
        footer = _truncate(" • ".join(tag_names), FOOTER_LIMIT)
        if footer:
            embed["footer"] = {"text": footer}

    return embed


def build_payload(news, webhook, tag_names: list[str] | None = None) -> dict:
    """Формирует тело запроса к вебхуку Discord для конкретной новости."""
    payload: dict = {"embeds": [build_embed(news, tag_names)]}

    # имя отправителя: из новости -> из вебхука -> не задаём
    username = news.username or getattr(webhook, "default_username", None)
    username = _truncate(username, USERNAME_LIMIT)
    if username:
        payload["username"] = username

    avatar = news.avatar_url or getattr(webhook, "default_avatar", None)
    if avatar:
        payload["avatar_url"] = avatar

    return payload


def send_payload(url: str, payload: dict) -> SendResult:
    """Отправляет payload в вебхук. Один повтор при 429 (rate limit).

    Используем ?wait=true, чтобы получить id созданного сообщения.
    """
    params = {"wait": "true"}
    try:
        with httpx.Client(timeout=settings.discord_timeout) as client:
            for attempt in range(2):
                resp = client.post(url, params=params, json=payload)

                if resp.status_code == 429 and attempt == 0:
                    # уважаем заголовок/тело rate limit и повторяем один раз
                    retry_after = _parse_retry_after(resp)
                    time.sleep(min(retry_after, 5.0))
                    continue

                if resp.status_code in (200, 204):
                    message_id = None
                    if resp.status_code == 200:
                        try:
                            message_id = str(resp.json().get("id"))
                        except Exception:  # noqa: BLE001
                            message_id = None
                    return SendResult(
                        success=True,
                        status_code=resp.status_code,
                        message_id=message_id,
                    )

                return SendResult(
                    success=False,
                    status_code=resp.status_code,
                    error=_short_body(resp),
                )
    except httpx.HTTPError as exc:
        return SendResult(success=False, error=f"Сетевая ошибка: {exc}")

    return SendResult(success=False, error="Не удалось отправить (429)")


def _parse_retry_after(resp: httpx.Response) -> float:
    # сначала пробуем JSON-поле retry_after (секунды), затем заголовок
    try:
        data = resp.json()
        if isinstance(data, dict) and "retry_after" in data:
            return float(data["retry_after"])
    except Exception:  # noqa: BLE001
        pass
    header = resp.headers.get("Retry-After")
    if header:
        try:
            return float(header)
        except ValueError:
            return 1.0
    return 1.0


def _short_body(resp: httpx.Response) -> str:
    text = resp.text or ""
    return text[:500]
