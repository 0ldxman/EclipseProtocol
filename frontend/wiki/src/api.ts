/**
 * Client for the public wiki API.
 *
 * Read-only by design. Nothing here can change a record - editing happens in
 * the admin over a collaborative document - so every call is a plain GET and
 * the whole surface is four endpoints.
 */

import { appRoot } from "./app-root.js";

export interface NavNode {
  id: string;
  kind: "folder" | "record";
  name: string;
  parentId: string | null;
  order: number;
  slug?: string;
  tags: string[];
  access: number;
  updatedAt: string;
}

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface RecordPage {
  node: NavNode;
  breadcrumb: { id: string; name: string }[];
  access: number;
  restricted: boolean;
  backlinks: { slug: string; title: string }[];
  html: string;
  infoboxes: string[];
  headings: Heading[];
  excerpt: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  access: number;
  restricted: boolean;
  score: number;
  snippet: string;
}

export interface Overview {
  records: number;
  folders: number;
  restricted: number;
  bytes: number;
  recent: { slug: string; title: string; updatedAt: string; restricted: boolean }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${appRoot}/api/wiki${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError((payload as { error?: string }).error ?? response.statusText, response.status);
  }
  return payload as T;
}

let navCache: Promise<{ nodes: NavNode[] }> | null = null;

/** The navigation tree. Cached: every page wants it, none of them change it. */
export function nav(force = false): Promise<{ nodes: NavNode[] }> {
  if (force) navCache = null;
  navCache ??= get<{ nodes: NavNode[] }>("/nav");
  return navCache;
}

export const record = (slug: string): Promise<RecordPage> =>
  get<RecordPage>(`/records/${encodeURIComponent(slug)}`);

export const search = (query: string): Promise<{ results: SearchHit[] }> =>
  get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(query)}`);

export const overview = (): Promise<Overview> => get<Overview>("/overview");
