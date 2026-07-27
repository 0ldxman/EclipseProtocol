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
  /** Папки: строка о разделе, которую читают снаружи категории. */
  summary: string;
  access: number;
  updatedAt: string;
}

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface RecordLink {
  slug: string;
  title: string;
}

/** Ближайшая обложка вверх по дереву — та, которой принадлежит запись. */
export interface Belongs {
  id: string;
  name: string;
  theme: string;
  logo: string;
  mark: string;
}

export interface FolderPage {
  node: NavNode;
  breadcrumb: { id: string; name: string }[];
  access: number;
  restricted: boolean;
  /** Отрисованный титульный лист категории, если у неё есть свой _cover. */
  cover: string;
}

export interface TimelineEvent {
  slug: string;
  title: string;
  at: string;
  epoch: string;
  access: number;
  restricted: boolean;
  summary: string;
  /** Первая картинка записи; у закрытой — пусто. */
  image: string;
}

export interface Timeline {
  epochs: { name: string; from: string; to: string; count: number }[];
  events: TimelineEvent[];
  /** Год мира и подпись под ним: настройка архива, а не часы читателя. */
  now: { year: number; label: string };
}

export interface RecordPage {
  node: NavNode;
  breadcrumb: { id: string; name: string }[];
  access: number;
  restricted: boolean;
  backlinks: RecordLink[];
  siblings: { prev: RecordLink | null; next: RecordLink | null };
  belongs: Belongs | null;
  html: string;
  infoboxes: string[];
  headings: Heading[];
  excerpt: string;
  /** Only on a record above the reader's clearance: how much is withheld. */
  hidden?: { chars: number; sections: number; attachments: number };
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

export const folder = (id: string): Promise<FolderPage> =>
  get<FolderPage>(`/folders/${encodeURIComponent(id)}`);

export const timeline = (): Promise<Timeline> => get<Timeline>("/timeline");
