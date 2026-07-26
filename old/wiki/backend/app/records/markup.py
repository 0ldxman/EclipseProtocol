"""Parser for the wiki's markup language (content + meta/infobox fields share it).

Base inline markup: ***bold italic***, **bold**, *italic*, ||spoiler||,
[[Display|link_name]].
Block markup (line-based): bullet lists (`- ` / `* `, nested by indentation)
and ordered lists (`1.`, nested via dotted numbering `1.1.`, `1.1.1.`).
Inline widgets (flat args, parens): tag, bar, dotbar, map, image, quote,
countdown, timestamp.
Block widgets (braces, row data): table (keyed header/records), gallery and
discord_msg (plain row list, no header).

An unknown widget name is left as literal text rather than erroring, so a
typo doesn't break the rest of the page (see WIDGET_ARGS / BLOCK_WIDGETS).

The last positional argument of every widget is greedy - it absorbs any
remaining text including commas - so e.g. quote()'s free-text `content`
argument doesn't get mangled by commas inside it. The same greedy-last-cell
rule applies to table/gallery/discord_msg row cells via their fixed arity,
but a comma inside a *non-last* cell will still split incorrectly - a known
limitation, not expected to matter for the short label-like fields those
widgets take.
"""

import re

# name -> number of positional args (last one is greedy, absorbs the rest)
WIDGET_ARGS = {
    "tag": 3,  # content, style, hex_code
    "bar": 3,  # name, max, current
    "dotbar": 3,  # name, max, current
    "map": 3,  # zoom, lat, lng
    "image": 3,  # header, footer, url
    "quote": 3,  # author, date, content
    "countdown": 2,  # date, time
    "timestamp": 2,  # date, time
}

# name -> fixed cell count per row (for block widgets without an explicit header)
BLOCK_ROW_ARITY = {
    "gallery": 3,  # header, footer, url
    "discord_msg": 1,  # discord_message_url
}

BLOCK_WIDGET_NAMES = {"table", "gallery", "discord_msg"}

BLOCK_OPEN_RE = re.compile(r"^\s*-?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\{\s*$")

# Заголовки: #, ##, ### (до ###### на всякий случай). Уровень = число решёток.
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")

# Bullet item: "- text" / "* text"; nesting by leading-space indentation.
BULLET_ITEM_RE = re.compile(r"^(?P<indent>\s*)[-*]\s+(?P<content>.+)$")
# Ordered item: "1. text", nesting via dotted numbering "1.1.", "1.1.1.".
# Depth is the number of dotted segments minus one.
ORDERED_ITEM_RE = re.compile(r"^\s*(?P<num>\d+(?:\.\d+)*)\.\s+(?P<content>.+)$")

# Order matters: ***...*** must be tried before **...**, which must be tried
# before *...*, otherwise the shorter delimiter would steal the asterisks.
INLINE_TOKEN_RE = re.compile(
    r"\*\*\*(?P<bolditalic>.+?)\*\*\*"
    r"|\*\*(?P<bold>.+?)\*\*"
    r"|\*(?P<italic>.+?)\*"
    r"|\|\|(?P<spoiler>.+?)\|\|"
    r"|\[\[(?P<link_display>[^\[\]|]+)\|(?P<link_target>[^\[\]|]+)\]\]"
    r"|(?P<widget_name>[a-zA-Z_][a-zA-Z0-9_]*)\((?P<widget_args>[^()]*)\)",
    re.DOTALL,
)


def split_args(text: str, arity: int) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if arity <= 1:
        return [text]
    return [p.strip() for p in text.split(",", arity - 1)]


def parse_inline(text: str) -> list[dict]:
    nodes: list[dict] = []
    pos = 0
    for m in INLINE_TOKEN_RE.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos : m.start()]})

        if m.group("bolditalic") is not None:
            nodes.append({"type": "bolditalic", "children": parse_inline(m.group("bolditalic"))})
        elif m.group("bold") is not None:
            nodes.append({"type": "bold", "children": parse_inline(m.group("bold"))})
        elif m.group("italic") is not None:
            nodes.append({"type": "italic", "children": parse_inline(m.group("italic"))})
        elif m.group("spoiler") is not None:
            nodes.append({"type": "spoiler", "children": parse_inline(m.group("spoiler"))})
        elif m.group("link_target") is not None:
            nodes.append(
                {"type": "link", "display": m.group("link_display"), "target": m.group("link_target")}
            )
        else:
            name = m.group("widget_name")
            if name in WIDGET_ARGS:
                args = split_args(m.group("widget_args"), WIDGET_ARGS[name])
                nodes.append({"type": "widget", "name": name, "args": args})
            else:
                nodes.append({"type": "text", "text": m.group(0)})

        pos = m.end()

    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return nodes


def _strip_row_prefix(line: str) -> str:
    line = line.strip()
    return line[1:].strip() if line.startswith("-") else line


def parse_block(name: str, body_lines: list[str]) -> dict:
    if name == "table":
        header: list[str] = []
        rows: list[list[list[dict]]] = []
        mode: str | None = None
        for raw in body_lines:
            line = raw.strip()
            if not line:
                continue
            if line == "header:":
                mode = "header"
                continue
            if line == "records:":
                mode = "records"
                continue
            if mode == "header":
                header.append(_strip_row_prefix(line))
            elif mode == "records":
                cells = split_args(_strip_row_prefix(line), max(len(header), 1))
                rows.append([parse_inline(cell) for cell in cells])
        return {"type": "widget_block", "name": "table", "header": header, "rows": rows}

    arity = BLOCK_ROW_ARITY[name]
    rows = []
    for raw in body_lines:
        line = raw.strip()
        if not line:
            continue
        cells = split_args(_strip_row_prefix(line), arity)
        rows.append([parse_inline(cell) for cell in cells])
    return {"type": "widget_block", "name": name, "rows": rows}


def _slugify(text: str, seen: dict[str, int]) -> str:
    """Стабильный id заголовка для якорей/TOC. \\w в Python по умолчанию ловит
    и кириллицу, так что русские заголовки получают читаемый slug. Дубликаты
    разводятся суффиксом."""
    base = re.sub(r"[^\w]+", "-", text.lower(), flags=re.UNICODE).strip("-") or "section"
    n = seen.get(base, 0)
    seen[base] = n + 1
    return base if n == 0 else f"{base}-{n}"


def _match_list_item(line: str) -> tuple[int, bool, str] | None:
    """Return (depth, ordered, content) for a list line, or None.

    Ordered depth comes from the dotted numbering (`1.`=0, `1.1.`=1, ...);
    bullet depth from the leading-space indentation (2 spaces / tab per level).
    """
    m = ORDERED_ITEM_RE.match(line)
    if m:
        return m.group("num").count("."), True, m.group("content").strip()
    m = BULLET_ITEM_RE.match(line)
    if m:
        indent = m.group("indent").replace("\t", "  ")
        return len(indent) // 2, False, m.group("content").strip()
    return None


def build_list_tree(entries: list[tuple[int, bool, str]]) -> list[dict]:
    """Fold a flat run of (depth, ordered, content) items into nested list nodes.

    A list node is {"type": "list", "ordered": bool, "items": [item, ...]} where
    each item is {"content": [inline nodes], "children": [nested list node, ...]}.
    """
    top: list[dict] = []
    stack: list[dict] = []  # frames: {depth, ordered, node, item}
    for depth, ordered, content in entries:
        item = {"content": parse_inline(content), "children": []}
        while stack and stack[-1]["depth"] > depth:
            stack.pop()
        if stack and stack[-1]["depth"] == depth:
            if stack[-1]["ordered"] == ordered:
                stack[-1]["node"]["items"].append(item)
                stack[-1]["item"] = item
                continue
            # same depth, different list type -> start a sibling list
            stack.pop()
        node = {"type": "list", "ordered": ordered, "items": [item]}
        if stack:
            stack[-1]["item"]["children"].append(node)
        else:
            top.append(node)
        stack.append({"depth": depth, "ordered": ordered, "node": node, "item": item})
    return top


def parse_markup(text: str) -> list[dict]:
    nodes: list[dict] = []
    buffer_lines: list[str] = []
    slugs: dict[str, int] = {}

    def flush_buffer() -> None:
        if not buffer_lines:
            return
        joined = "\n".join(buffer_lines)
        if joined.strip():
            nodes.extend(parse_inline(joined))
        buffer_lines.clear()

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        heading = HEADING_RE.match(lines[i])
        if heading:
            flush_buffer()
            level = len(heading.group(1))
            text_part = heading.group(2).strip()
            nodes.append(
                {
                    "type": "heading",
                    "level": level,
                    "id": _slugify(text_part, slugs),
                    "children": parse_inline(text_part),
                }
            )
            i += 1
            continue

        match = BLOCK_OPEN_RE.match(lines[i])
        if match and match.group(1) in BLOCK_WIDGET_NAMES:
            flush_buffer()
            name = match.group(1)
            body_lines: list[str] = []
            i += 1
            while i < len(lines) and lines[i].strip() != "}":
                body_lines.append(lines[i])
                i += 1
            nodes.append(parse_block(name, body_lines))
            i += 1
            continue

        if _match_list_item(lines[i]) is not None:
            flush_buffer()
            entries: list[tuple[int, bool, str]] = []
            while i < len(lines):
                block = BLOCK_OPEN_RE.match(lines[i])
                if block and block.group(1) in BLOCK_WIDGET_NAMES:
                    break
                item = _match_list_item(lines[i])
                if item is None:
                    break
                entries.append(item)
                i += 1
            nodes.extend(build_list_tree(entries))
            continue

        buffer_lines.append(lines[i])
        i += 1

    flush_buffer()
    return nodes


# --- производные значения для таймлайна ----------------------------------------


def first_image_url(nodes: list[dict]) -> str | None:
    """Первый виджет image в AST (обычно — картинка инфобокса). url = args[2]."""
    for node in nodes:
        ntype = node.get("type")
        if ntype == "widget" and node.get("name") == "image":
            args = node.get("args") or []
            if len(args) >= 3 and args[2].strip():
                return args[2].strip()
        # рекурсивно обходим вложенные структуры
        for key in ("children", "items", "rows"):
            child = node.get(key)
            if isinstance(child, list):
                found = first_image_url(
                    [c for c in child if isinstance(c, dict)]
                )
                if found:
                    return found
    return None


def _collect_text(nodes: list[dict], out: list[str]) -> None:
    for node in nodes:
        if not isinstance(node, dict):
            continue
        # заголовки секций — не проза, в эксцерпт не берём
        if node.get("type") == "heading":
            continue
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        for key in ("children", "items"):
            child = node.get(key)
            if isinstance(child, list):
                _collect_text([c for c in child if isinstance(c, dict)], out)


def excerpt(nodes: list[dict], words: int = 24) -> str:
    """Первые N слов из текстовых узлов content (для ховеркарда)."""
    out: list[str] = []
    _collect_text(nodes, out)
    text = " ".join(" ".join(out).split())
    parts = text.split(" ")
    if len(parts) <= words:
        return text
    return " ".join(parts[:words]).rstrip(" ,.;:—-") + "…"
