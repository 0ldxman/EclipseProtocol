"""Настройка Jinja2-шаблонов и пользовательских фильтров."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi.templating import Jinja2Templates

from app.config import settings
from app.utils import int_to_hex

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _plural_ru(n: int, one: str, few: str, many: str) -> str:
    """Русское склонение: 1 минута / 2 минуты / 5 минут."""
    n = abs(n) % 100
    if 11 <= n <= 14:
        return many
    last = n % 10
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many


def timeago(value: datetime | None) -> str:
    """Относительное время в прошлом, по-русски. Время трактуется как UTC."""
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta = now - value
    secs = int(delta.total_seconds())
    if secs < 0:
        secs = 0

    if secs < 60:
        return "только что"
    mins = secs // 60
    if mins < 60:
        return f"{mins} {_plural_ru(mins, 'минуту', 'минуты', 'минут')} назад"
    hours = mins // 60
    if hours < 24:
        return f"{hours} {_plural_ru(hours, 'час', 'часа', 'часов')} назад"
    days = hours // 24
    if days < 7:
        return f"{days} {_plural_ru(days, 'день', 'дня', 'дней')} назад"
    if days < 31:
        weeks = days // 7
        return f"{weeks} {_plural_ru(weeks, 'неделю', 'недели', 'недель')} назад"
    # дальше — обычная дата
    return value.strftime("%d.%m.%Y")


templates.env.filters["to_hex"] = int_to_hex
templates.env.filters["timeago"] = timeago
templates.env.globals["app_title"] = settings.app_title


_MONTHS_RU = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
]


def today_ru() -> str:
    now = datetime.now()
    return f"{now.day} {_MONTHS_RU[now.month - 1]} {now.year}"


templates.env.globals["today_ru"] = today_ru
