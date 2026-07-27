/**
 * Вложения: приём, перечень и удаление.
 *
 * Файлы лежат обычными файлами рядом друг с другом, а разметка ссылается на
 * них адресом `uploads/…`. В CRDT им не место — синхронизировать нужно
 * расстановку, а не мегабайты, — и в дереве записей тоже: вложение не
 * принадлежит одной записи, на одну картинку могут ссылаться пять.
 *
 * Отсюда и перечень. Раньше загруженный файл исчезал из виду в ту же секунду:
 * адрес возвращался один раз в ответе, и второй раз найти его было негде.
 * Каталог вложений — не украшение админки, а единственное место, где видно,
 * что уже загружено.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

export interface AssetsOptions {
  uploadDir: string;
}

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Что принимается и чем это становится на диске.
 *
 * Расширение берётся отсюда, а не из присланного имени: имя файла — это то,
 * что написал чужой браузер, и делать из него путь на диске нельзя.
 */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
};

const CONTENT_TYPES = new RegExp(
  `^(?:${[
    "image/(?:png|jpeg|webp|gif|svg\\+xml)",
    "video/(?:mp4|webm)",
    "audio/(?:mpeg|ogg)",
    "application/(?:pdf|zip)",
  ].join("|")})$`,
);

/** Чем виджет показывает файл: от этого зависит и значок, и заготовка разметки. */
export type AssetKind = "image" | "video" | "audio" | "file";

const KIND_BY_EXTENSION: Record<string, AssetKind> = {
  ".png": "image", ".jpg": "image", ".webp": "image", ".gif": "image", ".svg": "image",
  ".mp4": "video", ".webm": "video",
  ".mp3": "audio", ".ogg": "audio",
  ".pdf": "file", ".zip": "file",
};

export interface Asset {
  name: string;
  url: string;
  kind: AssetKind;
  bytes: number;
  at: string;
}

/** Имя, которое мы сами и выдали. Всё остальное к файлам не подпускается. */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*\.[a-z0-9]{2,4}$/i;

export async function registerAssets(app: FastifyInstance, options: AssetsOptions): Promise<void> {
  const { uploadDir } = options;
  await mkdir(uploadDir, { recursive: true });

  // Тело приходит сырым: файл не заворачивается в multipart ради одного поля.
  app.addContentTypeParser(
    CONTENT_TYPES,
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post("/api/uploads", async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "ожидается файл в теле запроса" });
    }
    const type = req.headers["content-type"]?.split(";")[0] ?? "";
    const extension = EXTENSION_BY_TYPE[type];
    if (!extension) return reply.code(415).send({ error: `тип не принимается: ${type}` });

    const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}${extension}`;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, name), body);
    app.log.info({ name, bytes: body.length }, "upload stored");
    return {
      url: `uploads/${name}`,
      name,
      kind: KIND_BY_EXTENSION[extension] ?? "file",
      bytes: body.length,
      at: new Date().toISOString(),
    } satisfies Asset;
  });

  /** Перечень, новые сверху: каталог читают, чтобы найти недавнее. */
  app.get("/api/uploads", async () => {
    const names = await readdir(uploadDir).catch(() => [] as string[]);
    const assets: Asset[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const extension = path.extname(name).toLowerCase();
      const info = await stat(path.join(uploadDir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      assets.push({
        name,
        url: `uploads/${name}`,
        kind: KIND_BY_EXTENSION[extension] ?? "file",
        bytes: info.size,
        at: info.mtime.toISOString(),
      });
    }
    assets.sort((a, b) => b.at.localeCompare(a.at));
    return { assets };
  });

  app.delete("/api/uploads/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    // basename и проверка образца — две разные защиты, и нужны обе: одна
    // отрезает путь, другая не пускает то, чего мы никогда не выдавали.
    const safe = path.basename(name);
    if (safe !== name || !SAFE_NAME.test(safe)) {
      return reply.code(400).send({ error: "недопустимое имя файла" });
    }
    try {
      await unlink(path.join(uploadDir, safe));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "файл не найден" });
      }
      throw err;
    }
    app.log.info({ name: safe }, "upload removed");
    return { removed: safe };
  });
}
