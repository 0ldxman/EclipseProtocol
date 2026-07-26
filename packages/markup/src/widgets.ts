/**
 * Turns markdown directives into widget elements.
 *
 * Split in two, and the split matters:
 *
 *   - `remarkUnknownDirectives` runs on the markdown tree and deals only with
 *     names that are not part of the vocabulary;
 *   - `directiveHandlers` plugs into remark-rehype and builds the actual
 *     elements.
 *
 * Building the element at the *rehype* stage is what lets a widget both wrap
 * user content and add chrome of its own. Doing it earlier, by writing
 * `hChildren` onto the markdown node, replaces the children wholesale - which
 * silently emptied every infobox that had a title.
 *
 * Unknown names degrade to literal text rather than disappearing.
 * remark-directive's own default is to drop them, so a single typo would delete
 * a paragraph - the worst possible failure mode for a wiki. They are reported
 * instead, so the editor can warn while the public page still reads sensibly.
 */

import type { ElementContent } from "hast";
import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import type { Handlers, State } from "mdast-util-to-hast";
import { visit } from "unist-util-visit";
import type { DirectiveKind, DirectiveSpec } from "./directives.js";

export interface WidgetReport {
  unknown: string[];
}

interface DirectiveNode {
  type: string;
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: unknown[];
}

const DIRECTIVE_TYPES = new Set<DirectiveKind>([
  "textDirective",
  "leafDirective",
  "containerDirective",
]);

/** How the source spelled a directive, for turning an unknown one back to text. */
function literalOf(name: string, kind: DirectiveKind, label: string): string {
  const marker = kind === "containerDirective" ? ":::" : kind === "leafDirective" ? "::" : ":";
  return label ? `${marker}${name}[${label}]` : `${marker}${name}`;
}

function attributesOf(node: DirectiveNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

interface UnknownOptions {
  directives: Record<string, DirectiveSpec>;
  report: WidgetReport;
}

export function remarkUnknownDirectives(options: UnknownOptions) {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      const kind = node.type as DirectiveKind;
      if (!DIRECTIVE_TYPES.has(kind)) return;

      const directive = node as unknown as DirectiveNode;
      const spec = options.directives[directive.name];
      if (spec && spec.kinds.includes(kind)) return;

      if (!options.report.unknown.includes(directive.name)) {
        options.report.unknown.push(directive.name);
      }
      if (!parent || typeof index !== "number") return;

      const literal = {
        type: "text" as const,
        value: literalOf(directive.name, kind, toString(node)),
      };
      // A container occupies a block slot, so it becomes a paragraph; inline
      // and leaf directives can be replaced by the text itself.
      (parent.children as unknown[]).splice(
        index,
        1,
        kind === "containerDirective" ? { type: "paragraph", children: [literal] } : literal,
      );
    });
  };
}

/** remark-rehype handlers for the three directive node types. */
export function directiveHandlers(directives: Record<string, DirectiveSpec>): Handlers {
  const build = (kind: DirectiveKind) => (state: State, node: unknown) => {
    const directive = node as DirectiveNode;
    const spec = directives[directive.name];
    // Unknown names were already rewritten to text upstream; if one somehow
    // reaches here, render its children rather than dropping them.
    if (!spec) {
      return { type: "element", tagName: "span", properties: {}, children: state.all(node as never) };
    }
    return spec.render({
      name: directive.name,
      kind,
      attributes: attributesOf(directive),
      children: state.all(node as never) as ElementContent[],
      text: toString(node as never),
    });
  };

  return {
    textDirective: build("textDirective"),
    leafDirective: build("leafDirective"),
    containerDirective: build("containerDirective"),
  } as unknown as Handlers;
}
