/**
 * Detail that follows the zoom.
 *
 * A simplified map is only simplified relative to a scale. The baked levels are
 * a tolerance in degrees, and a degree is a fixed number of pixels at a given
 * zoom, so each level has a zoom past which its error is visible:
 *
 *     error in pixels = tolerance_deg * 512 * 2^zoom / 360
 *
 * lod3 (0.02 deg) is half a pixel at z4 and twenty-nine pixels at z10.
 * That is the whole bug this module exists to fix: the map shipped one level,
 * the coarsest, and used it at every zoom. Overview looked right; anything
 * closer turned the coast into a polygon, worst of all on small islands, where
 * ten vertices is the entire outline rather than a rounding error on it.
 *
 * Two mechanisms, picked by how much of the world is on screen:
 *
 *   - **Whole-world swap** while the viewport is a large fraction of the
 *     planet. Windowing there would request most of the world anyway, and the
 *     bundle is one cacheable file (lod2 is 4.2 MB gzipped).
 *   - **Viewport refinement** past that, where the finer bundles are 15 MB and
 *     up but the viewport holds a few dozen arcs. The client asks for those
 *     arcs by id and gets kilobytes back.
 *
 * Both leave the topology's structure untouched - only coordinates change - so
 * ownership, feature ids, drawn shapes and the CRDT know nothing about it.
 */

import type maplibregl from "maplibre-gl";
import { LEVELS, Topology, rankOf, type Level } from "./topology";

/** Simplification tolerance each level was baked with, in degrees. */
const TOLERANCE_DEG: Record<Level, number> = {
  lod0: 0,
  lod1: 0.0005,
  lod2: 0.005,
  lod3: 0.02,
};

/**
 * How much simplification error is allowed to show. Below a pixel nobody can
 * see it; the margin buys the upgrade a little headroom so detail arrives just
 * before it is missed rather than just after.
 */
const ERROR_BUDGET_PX = 1.0;

/**
 * MapLibre's web mercator uses 512-pixel tiles, so the world is 512 * 2^zoom
 * pixels around, not 256. Getting this wrong is not a rounding error - it is a
 * whole zoom level of detail arriving late, which is exactly the artefact this
 * module is here to remove.
 */
const WORLD_PX_AT_Z0 = 512;

/** Levels available as whole-world bundles, coarsest first. */
const BASE_TIERS: Level[] = ["lod3", "lod2"];

/** Viewport padding, as a fraction of its size: small pans then need no fetch. */
const VIEW_PAD = 0.3;

/**
 * Refined arcs to hold before evicting what is off screen.
 *
 * A budget in arcs rather than in bytes, because the overlay's *length* is what
 * costs: the list travels to the style as a filter literal on every pass. This
 * is generous enough that ordinary panning never evicts, and small enough that
 * crossing a continent does not end up holding its whole coast at full
 * precision.
 */
const REFINED_ARC_BUDGET = 4000;

/**
 * Arcs per request. Deliberately well below what the server allows, because the
 * awkward case is not the deepest zoom but the moment just past where the last
 * whole-world tier gives up: the window is still wide, and asking for all of it
 * at once is a multi-megabyte stall. A capped pass simply asks again, so wide
 * views fill in over a few round trips instead of blocking on one.
 */
const ARCS_PER_REQUEST = 800;

/** The zoom at which a level's simplification error reaches the budget. */
export function maxUsefulZoom(level: Level): number {
  const tol = TOLERANCE_DEG[level];
  if (tol === 0) return Infinity;
  return Math.log2((ERROR_BUDGET_PX * 360) / (tol * WORLD_PX_AT_Z0));
}

/**
 * The coarsest level that still looks right at this zoom.
 *
 * Past the finest level that exists there is nothing better to ask for, so the
 * answer is that level - not the first entry of a list whose order depends on
 * what the server happened to report. Getting that wrong sends the map back to
 * the overview bundle exactly when it is zoomed in furthest.
 */
export function levelForZoom(zoom: number, available: readonly Level[]): Level {
  let finest: Level = "lod3";
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const level = LEVELS[i]!;
    if (!available.includes(level)) continue;
    finest = level;
    if (maxUsefulZoom(level) >= zoom) return level;
  }
  return finest;
}

export interface LodEvents {
  /** The whole-world base was replaced; everything must be re-derived. */
  onBase: (level: Level) => void;
  /**
   * Refinements changed. Both arguments describe the *whole* current overlay
   * rather than a diff, so a caller that renders them verbatim handles
   * eviction for free.
   */
  onRefined: (provinces: Set<number>, arcs: number[]) => void;
  onStatus: (text: string) => void;
}

interface DetailLevelInfo {
  lod: Level;
  quantization: number;
}

export class LodController {
  private available: Level[] = [...BASE_TIERS];
  private detail = new Map<Level, DetailLevelInfo>();
  private baseLoading: Level | null = null;
  private refining = false;
  private pending = false;
  private timer: number | null = null;
  private lastLevel: Level;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly topology: Topology,
    private readonly serverBase: string,
    private readonly events: LodEvents,
  ) {
    this.lastLevel = topology.level;
  }

  /**
   * Ask the server which fine levels it can slice. Failure is not fatal: the
   * ladder simply stops at the finest whole-world bundle, which is the
   * behaviour before any of this existed.
   */
  async start(): Promise<void> {
    try {
      const response = await fetch(`${this.serverBase}/geo/detail-levels`);
      if (response.ok) {
        const body = (await response.json()) as {
          levels: { lod: string; quantization: number }[];
        };
        for (const entry of body.levels) {
          const lod = entry.lod as Level;
          if (!LEVELS.includes(lod)) continue;
          this.detail.set(lod, { lod, quantization: entry.quantization });
          if (!this.available.includes(lod)) this.available.push(lod);
        }
      }
    } catch {
      // offline or an older server - keep the whole-world tiers only
    }

    this.map.on("moveend", () => this.schedule());
    this.map.on("zoomend", () => this.schedule());
    this.schedule();
  }

  /** The level the current zoom asks for. */
  targetLevel(): Level {
    return levelForZoom(this.map.getZoom(), this.available);
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    // A drag fires moveend once, but a wheel zoom fires several in a row;
    // waiting a moment means one pass per gesture rather than one per event.
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, 120);
  }

  private async run(): Promise<void> {
    if (this.refining || this.baseLoading) {
      this.pending = true;
      return;
    }
    const target = this.targetLevel();
    const targetRank = rankOf(target);
    this.lastLevel = target;

    // Whole-world tiers first: a base upgrade makes some refinements redundant,
    // so doing it the other way round would fetch arcs twice.
    const bestBase = BASE_TIERS.reduce((best, tier) =>
      rankOf(tier) < rankOf(best) && rankOf(tier) >= targetRank ? tier : best,
    );
    if (rankOf(bestBase) < rankOf(this.topology.level)) {
      await this.upgradeBase(bestBase);
      // The zoom that asked for a finer base may also want refinement on top,
      // and the view has probably moved while the bundle was in flight.
      this.pending = true;
      return this.drain();
    }
    if (targetRank >= rankOf(this.topology.level)) {
      this.report();
      return this.drain();
    }
    await this.refineViewport(target, targetRank);
    return this.drain();
  }

  private async drain(): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    await this.run();
  }

  private async upgradeBase(level: Level): Promise<void> {
    this.baseLoading = level;
    this.events.onStatus(`детализация: загрузка ${level}…`);
    try {
      const [header, buffer] = await Topology.loadHeader(`${this.serverBase}/geo`, level);
      this.topology.adoptBase(header, buffer);
      this.events.onBase(level);
      // A finer base makes some refinements redundant and `adoptBase` drops
      // them; the overlay has to be told, or it keeps drawing shapes that the
      // base is now perfectly capable of drawing itself.
      this.emitRefined();
      this.report();
    } catch (error) {
      this.events.onStatus(`детализация: не удалось загрузить ${level}`);
      console.error("base LOD upgrade failed", error);
      // Stop trying: a broken bundle would otherwise be re-requested on every
      // pan for the rest of the session.
      this.available = this.available.filter((l) => l !== level);
    } finally {
      this.baseLoading = null;
    }
  }

  /** The visible window, padded, in degrees. */
  private window(pad: number): [number, number, number, number] {
    const bounds = this.map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const padX = (east - west) * pad;
    const padY = (north - south) * pad;
    return [west - padX, south - padY, east + padX, north + padY];
  }

  private async refineViewport(level: Level, targetRank: number): Promise<void> {
    const info = this.detail.get(level);
    if (!info) return;

    const view = this.window(VIEW_PAD);
    const wanted = this.topology.arcsNeedingDetail(view, targetRank, ARCS_PER_REQUEST);

    let evicted: number[] = [];
    if (this.topology.refinedCount > REFINED_ARC_BUDGET) {
      // A wider window than the one that decides what to fetch, so a pan does
      // not throw away arcs it is about to ask for again.
      evicted = this.topology.evictOutside(this.window(VIEW_PAD * 3));
    }
    if (!wanted.length) {
      if (evicted.length) this.emitRefined();
      this.report();
      return;
    }

    this.refining = true;
    try {
      const response = await fetch(`${this.serverBase}/geo/arcs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lod: level, arcs: wanted }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const changed = this.topology.applyArcPatch(buffer, targetRank, info.quantization);
      if (changed.length || evicted.length) this.emitRefined();
      this.report();
      // The pass filled its quota, so there is probably more in view. Ask
      // again rather than waiting for the user to move the map.
      if (wanted.length === ARCS_PER_REQUEST) this.pending = true;
    } catch (error) {
      this.events.onStatus(`детализация: ${level} недоступен`);
      console.error("arc refinement failed", error);
      this.detail.delete(level);
      this.available = this.available.filter((l) => l !== level);
    } finally {
      this.refining = false;
    }
  }

  private emitRefined(): void {
    const arcs = this.topology.refinedArcs();
    this.events.onRefined(this.topology.provincesOfArcs(arcs), arcs);
  }

  private report(): void {
    const refined = this.topology.refinedCount;
    const suffix = refined ? ` +${refined} дуг ${this.lastLevel}` : "";
    this.events.onStatus(`детализация: ${this.topology.level}${suffix}`);
  }
}
