"""Вспомогательные функции: работа с цветом эмбеда и очистка строк."""

from __future__ import annotations

# Цвет Discord по умолчанию (blurple).
DEFAULT_COLOR = 0x5865F2


def hex_to_int(value: str | None) -> int | None:
    """'#5865F2' / '5865F2' -> 5793266. Пустая строка -> None."""
    if value is None:
        return None
    s = value.strip().lstrip("#")
    if not s:
        return None
    try:
        num = int(s, 16)
    except ValueError:
        return None
    # держим в допустимом диапазоне 0..0xFFFFFF
    return max(0, min(num, 0xFFFFFF))


def int_to_hex(value: int | None) -> str:
    """5793266 -> '#5865F2'. None -> цвет по умолчанию."""
    num = DEFAULT_COLOR if value is None else value
    num = max(0, min(int(num), 0xFFFFFF))
    return f"#{num:06X}"


def normalize_color(value: object) -> int | None:
    """Приводит значение цвета (строка hex или int) к int 0..0xFFFFFF.

    None -> None (поле не задано). Некорректная строка -> None.
    """
    if value is None:
        return None
    if isinstance(value, bool):  # bool — подкласс int, отсекаем заранее
        return None
    if isinstance(value, int):
        return max(0, min(value, 0xFFFFFF))
    if isinstance(value, str):
        return hex_to_int(value)
    return None


def clean_str(value: str | None) -> str | None:
    """Обрезает пробелы; пустую строку превращает в None."""
    if value is None:
        return None
    s = value.strip()
    return s or None
