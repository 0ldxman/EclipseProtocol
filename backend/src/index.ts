/**
 * Aether server: serves the pre-built geo topology bundle and hosts the
 * collaborative documents.
 *
 * Deliberately does no geometry work. Province outlines, country borders and
 * front lines are all derived in the browser from the arc topology, so painting
 * a province costs one small CRDT update here and nothing else - which is what
 * makes several admins editing the same map at once feasible.
 *
 * The built client is served from this same origin on purpose: the whole thing
 * then works behind the code-server path proxy without CORS or dev-server
 * websocket trouble.
 */

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerAssets } from "./assets.js";
import { RoomRegistry } from "./collab.js";
import { registerGeoDetail } from "./geo-detail.js";
import { registerRecords } from "./records.js";
import { SettingsStore } from "./settings.js";
import { TreeStore } from "./tree.js";
import { registerWiki } from "./wiki.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");

/**
 * Two kinds of directory, kept apart so the whole thing can be containerised.
 *
 * `GEO_DIR` is a build artefact - the baked topology bundle - and belongs in
 * the image beside the code. `DATA_DIR` is everything the wiki accumulates
 * while it runs (documents, rooms, uploads, the tree) and has to survive the
 * image being replaced, so in a container it is a volume. The defaults keep a
 * checkout working with no environment at all.
 */
const GEO_DIR = process.env.GEO_DIR ?? path.join(appRoot, "data/runtime");
const DATA_DIR = process.env.DATA_DIR ?? path.join(appRoot, "data");

/**
 * The fine levels of detail, deliberately *not* under `GEO_DIR`: they are read
 * a slice at a time through `/geo/arcs` and would be a 27 MB download if the
 * static handler could reach them.
 */
const GEO_DETAIL_DIR = process.env.GEO_DETAIL_DIR ?? path.join(appRoot, "data/geo-detail");

const WIKI_DIR = path.join(appRoot, "frontend/wiki/dist");
const MAP_DIR = path.join(appRoot, "frontend/map-proto/dist");
const ADMIN_DIR = path.join(appRoot, "frontend/wiki-admin/dist");
const ROOM_DIR = path.join(DATA_DIR, "rooms");
const TREE_FILE = path.join(DATA_DIR, "tree.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const MARKDOWN_DIR = path.join(DATA_DIR, "records");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const PORT = Number(process.env.PORT ?? 3010);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const rooms = new RoomRegistry(ROOM_DIR);
const tree = new TreeStore(TREE_FILE);
await tree.load();
const settings = new SettingsStore(SETTINGS_FILE);
await settings.load();

// Global so the static topology payload gets compressed too; 6.4 MB of
// delta-encoded int32 comes down to about 4 MB on the wire.
await app.register(compress, { global: true, encodings: ["br", "gzip"], threshold: 4096 });
await app.register(websocket);

await app.register(fastifyStatic, {
  root: GEO_DIR,
  prefix: "/geo/",
  decorateReply: false,
  cacheControl: true,
  maxAge: "1h",
});

await mkdir(UPLOAD_DIR, { recursive: true });
await app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: "/uploads/",
  decorateReply: false,
  cacheControl: true,
  maxAge: "7d",
});

await app.register(fastifyStatic, {
  root: ADMIN_DIR,
  prefix: "/admin/",
  decorateReply: false,
});

await app.register(fastifyStatic, {
  root: MAP_DIR,
  prefix: "/map/",
  decorateReply: false,
});

// The public wiki owns the root: it is the thing readers come for. The admin
// and the map are tools, and sit on their own prefixes.
await app.register(fastifyStatic, {
  root: WIKI_DIR,
  prefix: "/",
  decorateReply: true,
});

/**
 * Deep links into the wiki (`/wiki/kremen`) are client-side routes, so anything
 * that is not an API call, an asset or another app has to come back as the
 * wiki's shell. Unknown API paths still 404 as they should.
 *
 * The shell is built with relative asset URLs, because that is what survives
 * code-server's path proxy - but a document served at `/wiki/kremen` resolves
 * those against `/wiki/`, where nothing is. Injecting a `<base>` of the right
 * depth fixes it in both worlds at once: the browser resolves it against the
 * URL it actually used, proxy prefix and all.
 */
const SERVER_PREFIXES = ["/api", "/geo/", "/uploads/", "/collab/", "/admin/", "/map/"];

app.setNotFoundHandler(async (req, reply) => {
  const isServerPath = SERVER_PREFIXES.some((prefix) => req.url.startsWith(prefix));
  if (req.method !== "GET" || isServerPath) {
    return reply.code(404).send({ error: "not found" });
  }
  // Read per request rather than at boot: the shell names hashed asset files,
  // so a cached copy points at a bundle that no longer exists the moment the
  // frontend is rebuilt under a running server.
  const shell = await readFile(path.join(WIKI_DIR, "index.html"), "utf8").catch(() => "");
  if (!shell) return reply.code(404).send({ error: "not found" });
  const url = req.url.split(/[?#]/)[0] ?? "/";
  const segments = url.split("/").filter(Boolean);
  const depth = url.endsWith("/") ? segments.length : Math.max(0, segments.length - 1);
  const base = depth === 0 ? "./" : "../".repeat(depth);
  return reply
    .type("text/html; charset=utf-8")
    .send(shell.replace("<head>", `<head><base href="${base}">`));
});

await registerGeoDetail(app, { detailDir: GEO_DETAIL_DIR });
await registerRecords(app, { tree, rooms, markdownDir: MARKDOWN_DIR });
await registerWiki(app, { tree, rooms, markdownDir: MARKDOWN_DIR, settings });

// Reference underlays: scans, concept art, exports from other tools. Stored as
// plain files and referenced by URL from the collaborative document, because a
// CRDT is the wrong place to put megabytes of image - only the placement
// (corners, opacity) belongs there, and that is what everyone needs synced.
await registerAssets(app, { uploadDir: UPLOAD_DIR });

/**
 * Настройки архива.
 *
 * Читать может кто угодно — год мира стоит в подвале летописи, — а править
 * только через админку. Отдельной проверки здесь нет ровно потому же, почему
 * её нет у дерева: служба входа в эту сборку ещё не подключена, и когда она
 * появится, оба места закрываются одним и тем же способом.
 */
app.get("/api/settings", async () => settings.get());

app.patch("/api/settings", async (req, reply) => {
  const body = req.body as { currentYear?: number | null; nowLabel?: string };
  const patch: Parameters<typeof settings.patch>[0] = {};
  if ("currentYear" in body) {
    const year = body.currentYear;
    if (year !== null && (typeof year !== "number" || !Number.isFinite(year))) {
      return reply.code(400).send({ error: "год — число или null" });
    }
    patch.currentYear = year;
  }
  if (body.nowLabel !== undefined) patch.nowLabel = String(body.nowLabel);
  return settings.patch(patch);
});

app.get("/api/health", async () => ({
  ok: true,
  rooms: rooms.stats(),
}));

app.get("/collab/:room", { websocket: true }, async (socket, req) => {
  const name = (req.params as { room: string }).room;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
    socket.close(1008, "bad room name");
    return;
  }
  const room = await rooms.get(name);
  room.addConnection(socket);
  app.log.info({ room: name, connections: room.connectionCount }, "collab join");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void rooms.saveAll().finally(() => process.exit(0));
  });
}

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`geo bundle from ${GEO_DIR}, mutable data in ${DATA_DIR}`);
app.log.info(`wiki from ${WIKI_DIR}, map from ${MAP_DIR}, admin from ${ADMIN_DIR}`);
