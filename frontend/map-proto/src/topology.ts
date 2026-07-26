/**
 * Loads the arc topology bundle and derives renderable geometry from it.
 *
 * The bundle stores the world's boundaries once, as arcs: each arc is a run of
 * boundary with a province on either side (or open sea on one). Nothing here
 * stores a country - countries are just an assignment of provinces to owners,
 * which is why re-deriving every border after a paint stroke costs one pass
 * over ~34k arcs instead of a polygon union.
 *
 * Coordinates arrive quantised to 1e-6 deg and delta-encoded within each arc,
 * which is what lets ~700k vertices travel in about 4 MB.
 *
 * ## Levels of detail
 *
 * Only the coordinates depend on the level. Which arcs make up a ring, which
 * provinces flank an arc, which ring belongs to which province - all of that is
 * baked once and shared by every LOD, because stage 3 simplifies arcs *in
 * place*. Arc 4102 is the same stretch of boundary at lod3 and at lod0.
 *
 * That is what makes detail cheap to change at runtime. A finer level is not a
 * different map to reload; it is new numbers under the same structure. So this
 * class keeps two things:
 *
 *   - a *base* level, whole-world, swappable (`adoptBase`), used when the
 *     viewport is a large fraction of the planet and windowing would fetch
 *     most of it anyway;
 *   - a *refinement* overlay (`refine`), per arc, for the zooms where the
 *     viewport holds a few dozen arcs and the whole-world file at that level
 *     would be tens of megabytes.
 *
 * Both funnel through `arcCoords`, so every consumer - province outlines,
 * country borders, coastlines - picks up the finer geometry without knowing
 * that levels exist.
 *
 * A ring may end up assembled from arcs at *different* levels, and that is
 * safe rather than merely tolerated: Douglas-Peucker never moves the endpoints
 * of the line it simplifies, so an arc has the same first and last vertex at
 * every LOD. A refined arc therefore meets its coarse neighbours exactly where
 * the coarse version did, and a half-refined province has no seam.
 */

/** Finest first: the index is the "rank", and smaller means more detailed. */
export const LEVELS = ["lod0", "lod1", "lod2", "lod3"] as const;
export type Level = (typeof LEVELS)[number];

export const rankOf = (level: Level): number => LEVELS.indexOf(level);

export interface TopologyHeader {
  lod: string;
  quantization: number;
  arcs: number;
  rings: number;
  provinces: number;
  binary: string;
  arrays: Record<string, { dtype: string; byteOffset: number; length: number }>;
}

export interface Province {
  fid: number;
  name: string;
  group: string;
  bbox: [number, number, number, number];
  name_needs_review?: boolean;
}

/** Decode one delta-encoded arc out of a packed int32 buffer. */
function decodeArc(packed: Int32Array, from: number, to: number, q: number): Float64Array {
  const xy = new Float64Array((to - from) * 2);
  let x = 0;
  let y = 0;
  for (let i = from; i < to; i++) {
    const dx = packed[i * 2]!;
    const dy = packed[i * 2 + 1]!;
    if (i === from) {
      x = dx;
      y = dy;
    } else {
      x += dx;
      y += dy;
    }
    const o = (i - from) * 2;
    xy[o] = x * q;
    xy[o + 1] = y * q;
  }
  return xy;
}

export class Topology {
  // Level-independent structure. Set once, never replaced.
  readonly arcLeft: Int32Array;
  readonly arcRight: Int32Array;
  readonly ringArc: Int32Array;
  readonly ringArcOff: Int32Array;
  readonly ringProv: Int32Array;
  readonly ringPart: Int32Array;
  readonly ringHole: Uint8Array;

  // Base level, swappable.
  private arcXY: Float64Array;
  private arcOff: Int32Array;
  private baseRank: number;

  /** Per-arc refinements, finer than the base. */
  private readonly refinedXY = new Map<number, Float64Array>();
  private readonly refinedRank = new Map<number, number>();

  /** Arc bounding boxes (4 per arc), for picking what a viewport can see. */
  private arcBBox: Float64Array;

  /** Rings grouped by province, so a subset can be re-derived on its own. */
  private readonly ringsByProvince: Int32Array[];

  constructor(
    header: TopologyHeader,
    buffer: ArrayBuffer,
    readonly provinces: Province[],
  ) {
    const view = <T>(name: string, ctor: new (b: ArrayBuffer, o: number, l: number) => T): T => {
      const spec = header.arrays[name];
      if (!spec) throw new Error(`topology bundle is missing array "${name}"`);
      return new ctor(buffer, spec.byteOffset, spec.length);
    };

    this.arcLeft = view("arc_left", Int32Array);
    this.arcRight = view("arc_right", Int32Array);
    this.ringArc = view("ring_arc", Int32Array);
    this.ringArcOff = view("ring_arc_off", Int32Array);
    this.ringProv = view("ring_prov", Int32Array);
    this.ringPart = view("ring_part", Int32Array);
    this.ringHole = view("ring_hole", Uint8Array);

    this.arcOff = view("arc_off", Int32Array);
    this.arcXY = Topology.decodeAll(view("arc_xy", Int32Array), this.arcOff, header.quantization);
    this.baseRank = rankOf(header.lod as Level);
    this.arcBBox = this.computeArcBBoxes();

    const buckets: number[][] = provinces.map(() => []);
    for (let r = 0; r < this.ringProv.length; r++) buckets[this.ringProv[r]!]!.push(r);
    this.ringsByProvince = buckets.map((rings) => Int32Array.from(rings));
  }

  /**
   * Undo the per-arc delta encoding once, up front: every later operation reads
   * these coordinates many times over.
   */
  private static decodeAll(packed: Int32Array, off: Int32Array, q: number): Float64Array {
    const xy = new Float64Array(packed.length);
    const arcCount = off.length - 1;
    for (let a = 0; a < arcCount; a++) {
      const start = off[a]!;
      const end = off[a + 1]!;
      let x = 0;
      let y = 0;
      for (let i = start; i < end; i++) {
        const dx = packed[i * 2]!;
        const dy = packed[i * 2 + 1]!;
        if (i === start) {
          x = dx;
          y = dy;
        } else {
          x += dx;
          y += dy;
        }
        xy[i * 2] = x * q;
        xy[i * 2 + 1] = y * q;
      }
    }
    return xy;
  }

  private computeArcBBoxes(): Float64Array {
    const count = this.arcCount;
    const box = new Float64Array(count * 4);
    for (let a = 0; a < count; a++) {
      const start = this.arcOff[a]!;
      const end = this.arcOff[a + 1]!;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = start; i < end; i++) {
        const x = this.arcXY[i * 2]!;
        const y = this.arcXY[i * 2 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      box[a * 4] = minX;
      box[a * 4 + 1] = minY;
      box[a * 4 + 2] = maxX;
      box[a * 4 + 3] = maxY;
    }
    return box;
  }

  static async loadHeader(base: string, level: Level): Promise<[TopologyHeader, ArrayBuffer]> {
    const header = (await (await fetch(`${base}/topology-${level}.json`)).json()) as TopologyHeader;
    const buffer = await (await fetch(`${base}/${header.binary}`)).arrayBuffer();
    return [header, buffer];
  }

  static async load(base: string, level: Level = "lod3"): Promise<Topology> {
    const [[header, buffer], provinces] = await Promise.all([
      Topology.loadHeader(base, level),
      fetch(`${base}/provinces.json`).then((r) => r.json() as Promise<Province[]>),
    ]);
    return new Topology(header, buffer, provinces);
  }

  get level(): Level {
    return LEVELS[this.baseRank]!;
  }

  get arcCount(): number {
    return this.arcOff.length - 1;
  }

  /** How many vertices the map is currently drawing from, base plus overlay. */
  vertexCount(): number {
    let total = this.arcXY.length / 2;
    for (const [arc, xy] of this.refinedXY) {
      total += xy.length / 2 - (this.arcOff[arc + 1]! - this.arcOff[arc]!);
    }
    return total;
  }

  get refinedCount(): number {
    return this.refinedXY.size;
  }

  refinedArcs(): number[] {
    return [...this.refinedXY.keys()];
  }

  /**
   * Drop refinements outside a window, so panning at high zoom does not
   * accumulate the whole world at full precision.
   *
   * Nothing is lost that cannot be fetched again in a few kilobytes, and the
   * arcs fall straight back to the base level - the caller re-derives whatever
   * provinces those arcs touched, which it has to do after refining anyway.
   */
  evictOutside(bbox: [number, number, number, number]): number[] {
    const [minX, minY, maxX, maxY] = bbox;
    const dropped: number[] = [];
    for (const a of this.refinedXY.keys()) {
      const o = a * 4;
      const outside =
        this.arcBBox[o + 2]! < minX ||
        this.arcBBox[o]! > maxX ||
        this.arcBBox[o + 3]! < minY ||
        this.arcBBox[o + 1]! > maxY;
      if (outside) dropped.push(a);
    }
    for (const a of dropped) {
      this.refinedXY.delete(a);
      this.refinedRank.delete(a);
    }
    return dropped;
  }

  /**
   * Replace the whole-world base with a finer bundle.
   *
   * The structure arrays are *not* touched - they are identical at every level
   * by construction, and the arc count is checked to make sure that assumption
   * still holds against the file that just arrived. Refinements at or coarser
   * than the new base become dead weight and are dropped.
   */
  adoptBase(header: TopologyHeader, buffer: ArrayBuffer): void {
    const spec = header.arrays["arc_xy"];
    const offSpec = header.arrays["arc_off"];
    if (!spec || !offSpec) throw new Error("topology bundle is missing arc arrays");
    const off = new Int32Array(buffer, offSpec.byteOffset, offSpec.length);
    if (off.length - 1 !== this.arcCount) {
      throw new Error(
        `arc count differs between levels (${off.length - 1} vs ${this.arcCount}) - ` +
          "the bundles were not built from the same topology",
      );
    }
    const packed = new Int32Array(buffer, spec.byteOffset, spec.length);
    this.arcOff = off;
    this.arcXY = Topology.decodeAll(packed, off, header.quantization);
    this.baseRank = rankOf(header.lod as Level);
    this.arcBBox = this.computeArcBBoxes();

    for (const [arc, rank] of [...this.refinedRank]) {
      if (rank >= this.baseRank) {
        this.refinedRank.delete(arc);
        this.refinedXY.delete(arc);
      }
    }
  }

  /** Attach finer coordinates for one arc. Coarser offers are ignored. */
  refine(arc: number, xy: Float64Array, rank: number): boolean {
    if (rank >= this.effectiveRank(arc)) return false;
    this.refinedXY.set(arc, xy);
    this.refinedRank.set(arc, rank);
    return true;
  }

  /** The detail an arc is currently drawn at. */
  effectiveRank(arc: number): number {
    return this.refinedRank.get(arc) ?? this.baseRank;
  }

  /**
   * Decode a `/geo/arcs` response and apply it.
   *
   * Layout mirrors the bundle: an id table, a vertex-count table, then the
   * same delta-int32 coordinates, so one decoder serves both paths.
   */
  applyArcPatch(buffer: ArrayBuffer, rank: number, quantization: number): number[] {
    const head = new Int32Array(buffer, 0, 1);
    const n = head[0]!;
    const ids = new Int32Array(buffer, 4, n);
    const counts = new Int32Array(buffer, 4 + n * 4, n);
    const coords = new Int32Array(buffer, 4 + n * 8);

    const changed: number[] = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const count = counts[i]!;
      const xy = decodeArc(coords, cursor, cursor + count, quantization);
      cursor += count;
      if (this.refine(ids[i]!, xy, rank)) changed.push(ids[i]!);
    }
    return changed;
  }

  /**
   * Arcs whose box meets the given window and that are still coarser than
   * `targetRank` - that is, exactly the work a refinement pass would do.
   *
   * A linear scan over 34k boxes is around a fifth of a millisecond, which is
   * far below the cost of the fetch it decides on, so there is no index here.
   */
  arcsNeedingDetail(
    bbox: [number, number, number, number],
    targetRank: number,
    limit: number,
  ): number[] {
    const [minX, minY, maxX, maxY] = bbox;
    const out: number[] = [];
    for (let a = 0; a < this.arcCount && out.length < limit; a++) {
      if (this.effectiveRank(a) <= targetRank) continue;
      const o = a * 4;
      if (this.arcBBox[o + 2]! < minX || this.arcBBox[o]! > maxX) continue;
      if (this.arcBBox[o + 3]! < minY || this.arcBBox[o + 1]! > maxY) continue;
      out.push(a);
    }
    return out;
  }

  /** Provinces flanking the given arcs - the shapes a refinement changes. */
  provincesOfArcs(arcs: Iterable<number>): Set<number> {
    const out = new Set<number>();
    for (const a of arcs) {
      const left = this.arcLeft[a]!;
      const right = this.arcRight[a]!;
      if (left >= 0) out.add(left);
      if (right >= 0) out.add(right);
    }
    return out;
  }

  /** Arc vertices as a coordinate list, reversed when the reference is negative. */
  arcCoords(ref: number): [number, number][] {
    const index = ref < 0 ? ~ref : ref;
    const out: [number, number][] = [];
    const fine = this.refinedXY.get(index);
    if (fine) {
      for (let i = 0; i < fine.length; i += 2) out.push([fine[i]!, fine[i + 1]!]);
    } else {
      const start = this.arcOff[index]!;
      const end = this.arcOff[index + 1]!;
      for (let i = start; i < end; i++) out.push([this.arcXY[i * 2]!, this.arcXY[i * 2 + 1]!]);
    }
    if (ref < 0) out.reverse();
    return out;
  }

  private ringCoords(r: number): [number, number][] | null {
    const refs = this.ringArc.subarray(this.ringArcOff[r]!, this.ringArcOff[r + 1]!);
    const ring: [number, number][] = [];
    for (const ref of refs) {
      const coords = this.arcCoords(ref);
      // Arcs meet at shared junction vertices; drop the duplicate join.
      for (let i = ring.length === 0 ? 0 : 1; i < coords.length; i++) ring.push(coords[i]!);
    }
    if (ring.length < 4) return null;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    return ring;
  }

  /**
   * Province outlines as GeoJSON MultiPolygons.
   *
   * Grouping is by (province, part) rather than by province alone, and that
   * distinction is the whole point: a GeoJSON Polygon treats every ring after
   * the first as a *hole*. Emitting one Polygon per province therefore renders
   * an archipelago as its largest island with all the others cut out of it -
   * which is what made the Danish and Maldivian provinces show up as ragged
   * black shapes. Each part gets its own outer ring plus that part's holes.
   *
   * `only` restricts the pass to a set of provinces, which is what lets a
   * refinement re-emit the dozen shapes it touched instead of all 3409.
   */
  provincePolygons(only?: ReadonlySet<number>): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    const wanted = only ?? null;

    for (let prov = 0; prov < this.ringsByProvince.length; prov++) {
      if (wanted && !wanted.has(prov)) continue;
      const rings = this.ringsByProvince[prov]!;
      if (!rings.length) continue;

      // part -> rings, outer ring first
      const parts = new Map<number, [number, number][][]>();
      for (const r of rings) {
        const ring = this.ringCoords(r);
        if (!ring) continue;
        const part = this.ringPart[r]!;
        let list = parts.get(part);
        if (!list) parts.set(part, (list = []));
        if (this.ringHole[r]) list.push(ring);
        else list.unshift(ring);
      }

      const polygons: [number, number][][][] = [];
      for (const list of parts.values()) if (list.length) polygons.push(list);
      if (!polygons.length) continue;

      const meta = this.provinces[prov]!;
      features.push({
        type: "Feature",
        id: meta.fid,
        properties: { prov, fid: meta.fid, name: meta.name, group: meta.group },
        geometry: { type: "MultiPolygon", coordinates: polygons },
      });
    }
    return { type: "FeatureCollection", features };
  }
}
