/**
 * Thin client for the record API.
 *
 * Everything here is a plain request/response call. The *content* of a record
 * does not travel this way - it lives in a collaborative document over a
 * websocket - so this deals only with structure: where things sit in the tree,
 * what they are called, and turning markdown into html for the preview.
 */

export type NodeKind = "folder" | "record";

export interface TreeNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  order: number;
  slug?: string;
  tags?: string[];
  accessLevel?: number;
  effectiveAccess?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RenderResult {
  html: string;
  links: string[];
  brokenLinks: string[];
  headings: { level: number; id: string; text: string }[];
  excerpt: string;
  firstImage: string | null;
  unknown: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  // Заголовок объявляется только когда тело есть. Fastify отклоняет запрос,
  // который назвался application/json и не прислал ничего, — из-за чего
  // удаление из админки молча возвращало 400 и узел оставался на месте.
  const headers = init?.body
    ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
    : (init?.headers ?? {});
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError((payload as { error?: string }).error ?? response.statusText, response.status);
  }
  return payload as T;
}

export class Api {
  constructor(private readonly base: string) {}

  tree(): Promise<{ nodes: TreeNode[] }> {
    return request(this.base, "/api/tree");
  }

  create(kind: NodeKind, name: string, parentId: string | null): Promise<TreeNode> {
    return request(this.base, "/api/tree/nodes", {
      method: "POST",
      body: JSON.stringify({ kind, name, parentId }),
    });
  }

  update(
    id: string,
    patch: Partial<Pick<TreeNode, "name" | "slug" | "tags" | "parentId" | "order" | "accessLevel">>,
  ): Promise<TreeNode> {
    return request(this.base, `/api/tree/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  rename(id: string, name: string): Promise<TreeNode> {
    return this.update(id, { name });
  }

  remove(id: string): Promise<{ removed: string[] }> {
    return request(this.base, `/api/tree/nodes/${id}`, { method: "DELETE" });
  }

  render(markdown: string): Promise<RenderResult> {
    return request(this.base, "/api/render", {
      method: "POST",
      body: JSON.stringify({ markdown }),
    });
  }
}
