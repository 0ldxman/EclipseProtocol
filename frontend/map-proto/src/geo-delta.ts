/**
 * Runtime geometry edits layered over the immutable base topology.
 *
 * The base is 3409 provinces baked offline - too heavy to rebuild whenever
 * somebody traces a missing island. So the base is never modified. Instead a
 * small delta holds what changed, and the effective map is derived as
 *
 *     base  -  deleted  +  drawn
 *
 * The delta stays tiny (a handful of shapes), lives in the CRDT alongside
 * ownership, and can be folded back into a fresh base bake later without any
 * of the runtime code knowing.
 *
 * Deleting is expressed as *hiding*, which falls out of the arc model for free:
 * an arc whose neighbour has been deleted simply resolves that side to "open
 * sea", so the remaining province grows a coastline exactly where the deleted
 * one used to be - no geometry is touched.
 *
 * Province identity is a string throughout: base provinces are their index in
 * decimal, drawn ones carry a "c:" prefix, so ownership and delta can share one
 * key space.
 */

import type { Topology } from "./topology";

export type ProvId = string;

export interface DrawnProvince {
  name: string;
  /** Outer ring, closed (first point repeated at the end). */
  ring: [number, number][];
}

export const isDrawn = (id: ProvId): boolean => id.startsWith("c:");

export class EffectiveGeo {
  constructor(
    private readonly topology: Topology,
    private readonly deleted: ReadonlySet<ProvId>,
    private readonly drawn: ReadonlyMap<ProvId, DrawnProvince>,
  ) {}

  /** Base province indices to hide - fed to the base layer's filter. */
  hiddenBaseIndices(): number[] {
    const out: number[] = [];
    for (const id of this.deleted) {
      if (!isDrawn(id)) out.push(Number(id));
    }
    return out;
  }

  /** Drawn provinces as polygons, for their own map source. */
  drawnFeatures(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (const [id, province] of this.drawn) {
      if (this.deleted.has(id)) continue;
      features.push({
        type: "Feature",
        id: hashId(id),
        properties: { prov: id, name: province.name, drawn: true },
        geometry: { type: "Polygon", coordinates: [province.ring] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private side(index: number): ProvId | null {
    if (index < 0) return null;
    const id = String(index);
    return this.deleted.has(id) ? null : id;
  }

  /**
   * Country outlines and coastlines for the current ownership.
   *
   * Base arcs are filtered exactly as before - only the resolution of each side
   * changed, so a deleted neighbour reads as sea. Drawn provinces are disjoint
   * shapes, so their ring is a single arc with sea on the outside.
   */
  borderLines(ownerOf: (id: ProvId) => string | null): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    for (let a = 0; a < this.topology.arcCount; a++) {
      const left = this.side(this.topology.arcLeft[a]!);
      const right = this.side(this.topology.arcRight[a]!);
      const ownerLeft = left === null ? null : ownerOf(left);
      const ownerRight = right === null ? null : ownerOf(right);
      if (ownerLeft === ownerRight) continue;
      features.push({
        type: "Feature",
        properties: { coast: left === null || right === null },
        geometry: { type: "LineString", coordinates: this.topology.arcCoords(a) },
      });
    }

    for (const [id, province] of this.drawn) {
      if (this.deleted.has(id)) continue;
      if (ownerOf(id) === null) continue;
      features.push({
        type: "Feature",
        properties: { coast: true },
        geometry: { type: "LineString", coordinates: province.ring },
      });
    }

    return { type: "FeatureCollection", features };
  }

  stats(): { base: number; hidden: number; drawn: number } {
    let hidden = 0;
    let drawnAlive = 0;
    for (const id of this.deleted) if (!isDrawn(id)) hidden++;
    for (const id of this.drawn.keys()) if (!this.deleted.has(id)) drawnAlive++;
    return { base: this.topology.provinces.length, hidden, drawn: drawnAlive };
  }
}

/** MapLibre feature ids must be numeric for feature-state; drawn ids are strings. */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // keep it positive and clear of the base fid range
  return 1_000_000 + (h >>> 0) % 1_000_000_000;
}

/** Signed area of a closed ring, in squared degrees - used to reject slivers. */
export function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
