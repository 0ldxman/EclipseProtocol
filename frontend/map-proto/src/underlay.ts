/**
 * Reference underlays: arbitrary images placed under the map to trace from.
 *
 * OSM and satellite tiles are not useful here - the world is not the real one,
 * so the references that matter are scans, concept art, exports from other
 * tools and old campaign maps. Each is pinned by its four corners, which is a
 * projective placement: enough for anything produced by a map tool or a
 * screenshot, and it needs no server-side warping at all because MapLibre
 * renders a corner-pinned image natively.
 *
 * Only the placement is collaborative. The image itself is uploaded once and
 * referenced by URL - megabytes do not belong in a CRDT, but "where does this
 * scan sit" is exactly the sort of thing two people need to agree on.
 *
 * Visibility is deliberately *not* shared: an underlay is a working aid, and
 * one person tracing from a scan should not impose it on everyone else.
 */

import maplibregl from "maplibre-gl";

/** MapLibre's image source wants exactly four corners, not a loose list. */
export type Corners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/** Narrows a mapped corner list back to the fixed-length tuple MapLibre needs. */
export function asCorners(points: [number, number][]): Corners {
  if (points.length !== 4) throw new Error(`expected 4 corners, got ${points.length}`);
  return points as Corners;
}

export interface Underlay {
  name: string;
  /** Path relative to the app base, as returned by the upload endpoint. */
  url: string;
  /** Corner order matches MapLibre's image source: TL, TR, BR, BL. */
  corners: Corners;
  opacity: number;
  locked: boolean;
}

const CORNER_LABELS = ["ЛВ", "ПВ", "ПН", "ЛН"];

/**
 * Initial placement: a rectangle covering the middle half of the viewport.
 *
 * Derived in *pixels* and unprojected, not by averaging latitudes. Degrees of
 * latitude are not evenly spaced on screen under Mercator, so splitting the
 * lat/lng bounds arithmetically pushes the lower corners below the window and
 * puts the drag handles out of reach.
 */
export function defaultCorners(map: maplibregl.Map): Corners {
  const { width, height } = map.getCanvas().getBoundingClientRect();
  const x0 = width * 0.3;
  const x1 = width * 0.75;
  const y0 = height * 0.28;
  const y1 = height * 0.72;
  const at = (x: number, y: number): [number, number] => {
    const { lng, lat } = map.unproject([x, y]);
    return [lng, lat];
  };
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
}

/**
 * Keeps MapLibre sources/layers and corner handles in step with the shared
 * underlay state. Rebuilding an image source is cheap, but re-adding it on
 * every drag frame would flicker, so placement updates go through
 * setCoordinates and only structural changes touch the style.
 */
export class UnderlayLayers {
  private readonly known = new Set<string>();
  private markers: maplibregl.Marker[] = [];
  private selected: string | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly base: string,
    private readonly onCornerDrag: (id: string, corners: Corners) => void,
  ) {}

  private sourceId = (id: string): string => `underlay:${id}`;

  /** `hidden` is per-user, so it is passed in rather than read from the doc. */
  sync(underlays: ReadonlyMap<string, Underlay>, hidden: ReadonlySet<string>): void {
    for (const id of [...this.known]) {
      if (!underlays.has(id)) this.remove(id);
    }

    for (const [id, underlay] of underlays) {
      const sourceId = this.sourceId(id);
      if (!this.known.has(id)) {
        this.map.addSource(sourceId, {
          type: "image",
          url: `${this.base}/${underlay.url}`,
          coordinates: underlay.corners,
        });
        this.map.addLayer(
          {
            id: sourceId,
            type: "raster",
            source: sourceId,
            paint: { "raster-opacity": underlay.opacity, "raster-fade-duration": 0 },
          },
          // Underlays sit beneath everything the map itself draws.
          this.map.getLayer("province-fill") ? "province-fill" : undefined,
        );
        this.known.add(id);
      } else {
        const source = this.map.getSource(sourceId) as maplibregl.ImageSource | undefined;
        source?.setCoordinates(underlay.corners);
        this.map.setPaintProperty(sourceId, "raster-opacity", underlay.opacity);
      }
      this.map.setLayoutProperty(sourceId, "visibility", hidden.has(id) ? "none" : "visible");
    }

    this.refreshHandles(underlays, hidden);
  }

  private remove(id: string): void {
    const sourceId = this.sourceId(id);
    if (this.map.getLayer(sourceId)) this.map.removeLayer(sourceId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    this.known.delete(id);
    if (this.selected === id) this.selected = null;
  }

  select(id: string | null): void {
    this.selected = id;
  }

  get selectedId(): string | null {
    return this.selected;
  }

  private refreshHandles(
    underlays: ReadonlyMap<string, Underlay>,
    hidden: ReadonlySet<string>,
  ): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];

    const id = this.selected;
    if (id === null) return;
    const underlay = underlays.get(id);
    if (!underlay || underlay.locked || hidden.has(id)) return;

    underlay.corners.forEach((corner, index) => {
      const element = document.createElement("div");
      element.className = "corner-handle";
      element.textContent = CORNER_LABELS[index]!;

      const marker = new maplibregl.Marker({ element, draggable: true })
        .setLngLat(corner)
        .addTo(this.map);

      marker.on("drag", () => {
        const { lng, lat } = marker.getLngLat();
        const next = asCorners(
          underlay.corners.map((c, i) => (i === index ? ([lng, lat] as [number, number]) : c)),
        );
        // Move the image live while dragging, but only publish on release -
        // otherwise every mouse frame becomes a CRDT update for everyone.
        const source = this.map.getSource(this.sourceId(id)) as maplibregl.ImageSource;
        source?.setCoordinates(next);
      });
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        const next = asCorners(
          underlay.corners.map((c, i) => (i === index ? ([lng, lat] as [number, number]) : c)),
        );
        this.onCornerDrag(id, next);
      });

      this.markers.push(marker);
    });
  }
}

/** Uploads an image and returns the path to reference it by. */
export async function uploadImage(base: string, file: File): Promise<string> {
  const response = await fetch(`${base}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status} ${await response.text()}`);
  }
  const { url } = (await response.json()) as { url: string };
  return url;
}
