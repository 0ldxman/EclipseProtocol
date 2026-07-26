/**
 * Arc refinement: the fine levels of detail, served a slice at a time.
 *
 * The client downloads one bundle for the whole world, and that bundle has to
 * be small enough to arrive before the map does - which caps it at a coarse
 * level. Zoom in past that level and the coast turns into a polygon: an island
 * 30 km across is ten vertices at lod3, because ten vertices is all anybody can
 * resolve when it is three pixels wide.
 *
 * Rather than ship a finer world (lod1 is 15 MB gzipped, lod0 over thirty),
 * the client asks for the arcs it can actually see. This is only possible
 * because arc numbering is shared across levels: arc 4102 is the same stretch
 * of boundary at every LOD, so refining it is swapping coordinates under a
 * ring, not rebuilding a topology.
 *
 * The server holds nothing but the offset tables (33 660 int32 per level) and
 * reads byte ranges out of the store on demand, coalescing arcs that happen to
 * be adjacent in the file into one read.
 */

import { open, readFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

export interface DetailOptions {
  /** Directory holding `detail-<lod>.json` / `.bin`, written by stage 5. */
  detailDir: string;
}

interface DetailHeader {
  lod: string;
  quantization: number;
  arcs: number;
  vertices: number;
  binary: string;
  arcOff: number[];
}

interface DetailStore {
  header: DetailHeader;
  offsets: Int32Array;
  handle: FileHandle;
}

/** Coordinates are int32 pairs, so one vertex is eight bytes in the store. */
const BYTES_PER_VERTEX = 8;

/**
 * Cap on one request. A viewport at the zooms where refinement matters holds
 * tens of arcs, not thousands; the cap is there so a client that asks for the
 * world at lod0 gets a 400 rather than 53 MB.
 */
const MAX_ARCS_PER_REQUEST = 6000;

export async function registerGeoDetail(
  app: FastifyInstance,
  options: DetailOptions,
): Promise<void> {
  const stores = new Map<string, DetailStore>();

  const load = async (lod: string): Promise<DetailStore | null> => {
    const existing = stores.get(lod);
    if (existing) return existing;
    // Only levels that were actually exported are addressable, and the name is
    // matched against a pattern first: it lands in a file path.
    if (!/^lod[0-9]$/.test(lod)) return null;
    try {
      const header = JSON.parse(
        await readFile(path.join(options.detailDir, `detail-${lod}.json`), "utf8"),
      ) as DetailHeader;
      const handle = await open(path.join(options.detailDir, header.binary), "r");
      const store: DetailStore = {
        header,
        offsets: Int32Array.from(header.arcOff),
        handle,
      };
      stores.set(lod, store);
      app.log.info(
        { lod, arcs: header.arcs, vertices: header.vertices },
        "geo detail store opened",
      );
      return store;
    } catch {
      return null;
    }
  };

  /** Which fine levels exist, so the client can shape its ladder to the data. */
  app.get("/geo/detail-levels", async () => {
    const available: { lod: string; arcs: number; vertices: number; quantization: number }[] = [];
    for (const lod of ["lod0", "lod1", "lod2"]) {
      const store = await load(lod);
      if (store) {
        available.push({
          lod,
          arcs: store.header.arcs,
          vertices: store.header.vertices,
          quantization: store.header.quantization,
        });
      }
    }
    return { levels: available, maxArcsPerRequest: MAX_ARCS_PER_REQUEST };
  });

  /**
   * Refined coordinates for a set of arcs.
   *
   * Response is one binary blob, in the same delta-int32 encoding as the
   * bundle so the client decodes it with the same code:
   *
   *     int32              arc count n
   *     int32 * n          arc ids, ascending
   *     int32 * n          vertex count per arc
   *     int32 * 2 * total  delta-encoded coordinates, arcs in the same order
   */
  app.post<{ Body: { lod?: string; arcs?: number[] } }>("/geo/arcs", async (req, reply) => {
    const lod = req.body?.lod ?? "";
    const requested = req.body?.arcs;
    if (!Array.isArray(requested) || requested.length === 0) {
      return reply.code(400).send({ error: "expected { lod, arcs: [...] }" });
    }
    if (requested.length > MAX_ARCS_PER_REQUEST) {
      return reply
        .code(400)
        .send({ error: `too many arcs: ${requested.length} > ${MAX_ARCS_PER_REQUEST}` });
    }
    const store = await load(lod);
    if (!store) return reply.code(404).send({ error: `no detail store for "${lod}"` });

    // Ascending and deduplicated: the order the file is laid out in, which is
    // what makes coalescing possible at all.
    const ids = [...new Set(requested)].sort((a, b) => a - b);
    for (const id of ids) {
      if (!Number.isInteger(id) || id < 0 || id >= store.header.arcs) {
        return reply.code(400).send({ error: `arc id out of range: ${id}` });
      }
    }

    const counts = ids.map((id) => store.offsets[id + 1]! - store.offsets[id]!);
    const total = counts.reduce((sum, n) => sum + n, 0);

    const headerBytes = 4 + ids.length * 8;
    const out = Buffer.allocUnsafe(headerBytes + total * BYTES_PER_VERTEX);
    out.writeInt32LE(ids.length, 0);
    for (let i = 0; i < ids.length; i++) {
      out.writeInt32LE(ids[i]!, 4 + i * 4);
      out.writeInt32LE(counts[i]!, 4 + ids.length * 4 + i * 4);
    }

    // Coalesce runs of arcs that are contiguous in the file: a viewport
    // selection is mostly neighbouring boundary, so this usually collapses
    // hundreds of small reads into a handful of large ones.
    let cursor = headerBytes;
    let i = 0;
    let reads = 0;
    while (i < ids.length) {
      let j = i;
      while (j + 1 < ids.length && ids[j + 1] === ids[j]! + 1) j++;
      const from = store.offsets[ids[i]!]! * BYTES_PER_VERTEX;
      const to = store.offsets[ids[j]! + 1]! * BYTES_PER_VERTEX;
      await store.handle.read(out, cursor, to - from, from);
      cursor += to - from;
      reads++;
      i = j + 1;
    }

    req.log.debug({ lod, arcs: ids.length, vertices: total, reads }, "geo arcs served");
    return reply
      .header("content-type", "application/octet-stream")
      .header("cache-control", "public, max-age=3600")
      .send(out);
  });

  app.addHook("onClose", async () => {
    for (const store of stores.values()) await store.handle.close();
    stores.clear();
  });
}
