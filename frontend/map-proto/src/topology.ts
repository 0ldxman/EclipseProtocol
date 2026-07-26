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
 */

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

export class Topology {
  readonly arcXY: Float64Array;      // decoded absolute lon/lat pairs
  readonly arcOff: Int32Array;       // vertex offsets, in points not floats
  readonly arcLeft: Int32Array;
  readonly arcRight: Int32Array;
  readonly ringArc: Int32Array;
  readonly ringArcOff: Int32Array;
  readonly ringProv: Int32Array;
  readonly ringPart: Int32Array;
  readonly ringHole: Uint8Array;

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

    const packed = view("arc_xy", Int32Array);
    this.arcOff = view("arc_off", Int32Array);
    this.arcLeft = view("arc_left", Int32Array);
    this.arcRight = view("arc_right", Int32Array);
    this.ringArc = view("ring_arc", Int32Array);
    this.ringArcOff = view("ring_arc_off", Int32Array);
    this.ringProv = view("ring_prov", Int32Array);
    this.ringPart = view("ring_part", Int32Array);
    this.ringHole = view("ring_hole", Uint8Array);

    // Undo the per-arc delta encoding once, up front: every later operation
    // reads these coordinates many times over.
    const q = header.quantization;
    const xy = new Float64Array(packed.length);
    const arcCount = this.arcOff.length - 1;
    for (let a = 0; a < arcCount; a++) {
      const start = this.arcOff[a]!;
      const end = this.arcOff[a + 1]!;
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
    this.arcXY = xy;
  }

  static async load(base: string, lod = "lod3"): Promise<Topology> {
    const header = (await (await fetch(`${base}/topology-${lod}.json`)).json()) as TopologyHeader;
    const [buffer, provinces] = await Promise.all([
      fetch(`${base}/${header.binary}`).then((r) => r.arrayBuffer()),
      fetch(`${base}/provinces.json`).then((r) => r.json() as Promise<Province[]>),
    ]);
    return new Topology(header, buffer, provinces);
  }

  get arcCount(): number {
    return this.arcOff.length - 1;
  }

  /** Arc vertices as a coordinate list, reversed when the reference is negative. */
  arcCoords(ref: number): [number, number][] {
    const index = ref < 0 ? ~ref : ref;
    const start = this.arcOff[index]!;
    const end = this.arcOff[index + 1]!;
    const out: [number, number][] = [];
    for (let i = start; i < end; i++) out.push([this.arcXY[i * 2]!, this.arcXY[i * 2 + 1]!]);
    if (ref < 0) out.reverse();
    return out;
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
   */
  provincePolygons(): GeoJSON.FeatureCollection {
    // province -> part -> rings, outer ring first
    const byProvince = new Map<number, Map<number, [number, number][][]>>();

    for (let r = 0; r < this.ringProv.length; r++) {
      const refs = this.ringArc.subarray(this.ringArcOff[r]!, this.ringArcOff[r + 1]!);
      const ring: [number, number][] = [];
      for (const ref of refs) {
        const coords = this.arcCoords(ref);
        // Arcs meet at shared junction vertices; drop the duplicate join.
        for (let i = ring.length === 0 ? 0 : 1; i < coords.length; i++) ring.push(coords[i]!);
      }
      if (ring.length < 4) continue;
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

      const prov = this.ringProv[r]!;
      let parts = byProvince.get(prov);
      if (!parts) byProvince.set(prov, (parts = new Map()));
      const part = this.ringPart[r]!;
      let rings = parts.get(part);
      if (!rings) parts.set(part, (rings = []));
      if (this.ringHole[r]) rings.push(ring);
      else rings.unshift(ring);
    }

    const features: GeoJSON.Feature[] = [];
    for (const [prov, parts] of byProvince) {
      const meta = this.provinces[prov]!;
      const polygons: [number, number][][][] = [];
      for (const rings of parts.values()) {
        if (rings.length) polygons.push(rings);
      }
      if (!polygons.length) continue;
      features.push({
        type: "Feature",
        id: meta.fid,
        properties: { prov, fid: meta.fid, name: meta.name, group: meta.group },
        geometry: { type: "MultiPolygon", coordinates: polygons },
      });
    }
    return { type: "FeatureCollection", features };
  }

  /**
   * Border lines for the current ownership: an arc is drawn only where the two
   * sides resolve to different controllers. Open arcs (sea on one side) are
   * drawn whenever their land side is owned, which is what produces coastlines
   * without storing any coastline data.
   *
   * `ownerOf` maps a province index to a controller key, or null for unowned.
   */
  borderLines(ownerOf: (prov: number) => string | null): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (let a = 0; a < this.arcCount; a++) {
      const left = this.arcLeft[a]!;
      const right = this.arcRight[a]!;
      const ownerLeft = left >= 0 ? ownerOf(left) : null;
      const ownerRight = right >= 0 ? ownerOf(right) : null;
      if (ownerLeft === ownerRight) continue;
      if (ownerLeft === null && ownerRight === null) continue;
      features.push({
        type: "Feature",
        properties: { coast: right < 0 || left < 0 },
        geometry: { type: "LineString", coordinates: this.arcCoords(a) },
      });
    }
    return { type: "FeatureCollection", features };
  }
}
