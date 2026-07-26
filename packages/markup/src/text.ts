/**
 * Две поправки к тому, как markdown понимает обычный текст.
 *
 * Обе — про то, что архив пишут не программисты. Человек, набирающий досье,
 * жмёт Enter там, где хочет перенос, и подчёркивает то, что подчёркивает
 * ручкой. Строгий markdown отвечает ему склеенным абзацем и полужирным.
 */

import type { Nodes, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";

/**
 * Перенос строки — это перенос строки.
 *
 * В markdown одиночный Enter внутри абзаца ничего не значит: строки
 * склеиваются. Для записей архива это неверно — список позывных, столбик дат,
 * четверостишие набирают строками, а не абзацами через пустую. Здесь каждый
 * одиночный перенос становится настоящим `<br>`.
 *
 * Блоки кода не затрагиваются: их содержимое лежит не в `text`, а в `code`.
 */
export function remarkSoftBreaks() {
  return (tree: Root): void => {
    walk(tree as unknown as Parent);
  };
}

/**
 * Директивы, разбирающие собственный текст построчно.
 *
 * У них перенос — синтаксис, а не оформление: `:::fields` читает «ключ ::
 * значение» по строкам. Превратить эти переносы в `<br>` значило бы склеить
 * все поля в одно.
 */
const LINE_ORIENTED = new Set(["fields"]);

interface Parent {
  type: string;
  name?: string;
  children?: { type: string; name?: string; value?: string; children?: unknown[] }[];
}

function walk(node: Parent): void {
  const children = node.children;
  if (!children) return;
  if (node.type === "containerDirective" && LINE_ORIENTED.has(node.name ?? "")) return;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === "text" && (child.value ?? "").includes("\n")) {
      const parts = (child.value ?? "").split("\n");
      const replacement: PhrasingContent[] = [];
      parts.forEach((part, n) => {
        if (n > 0) replacement.push({ type: "break" });
        if (part.length > 0) replacement.push({ type: "text", value: part });
      });
      children.splice(i, 1, ...(replacement as unknown as typeof children));
      i += replacement.length - 1;
      continue;
    }
    walk(child as unknown as Parent);
  }
}

/**
 * `__текст__` — подчёркивание, `**текст**` — полужирный.
 *
 * В markdown это синонимы, и одно из двух начертаний оказывается недоступно.
 * Различить их можно только по исходнику, поэтому плагин смотрит на символ,
 * с которого узел начался: разметка одна, а намерение у автора разное.
 */
export function remarkUnderline() {
  return (tree: Root, file: VFile): void => {
    const source = String(file.value);
    visit(tree, "strong", (node: Nodes) => {
      const at = node.position?.start?.offset;
      if (at === undefined || source[at] !== "_") return;
      node.data = { ...node.data, hName: "u" };
    });
  };
}
