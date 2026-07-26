/**
 * Map prototype: paint provinces into countries and edit geometry at runtime,
 * collaboratively.
 *
 * The point of this prototype is to prove the claims the architecture rests on,
 * in a form that can be clicked rather than argued about:
 *
 *   1. Borders are a filter, not a computation. Nothing is unioned and the
 *      server is never asked - painting a province re-derives every country
 *      outline in the browser from ~34k arcs.
 *   2. Two people can edit the same map at once. Ownership and geometry edits
 *      live in CRDT maps keyed by province, so simultaneous work on different
 *      provinces never conflicts.
 *   3. Geometry is editable without rebuilding the baked base: tracing a
 *      missing island or removing a bad province is a small delta on top.
 *   4. Detail follows the zoom. The base bundle is the coarse level, because
 *      that is what can arrive before the map does; finer geometry replaces it
 *      underneath, either as a whole-world tier or as the arcs the viewport can
 *      actually see. See `lod.ts`.
 */

import "@aether/theme/theme.css";
import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import * as Y from "yjs";
import { serverBase } from "./base-path";
import { CollabClient, collabUrl, type ConnectionState } from "./collab";
import { EffectiveGeo, hashId, isDrawn, ringArea, type DrawnProvince, type ProvId } from "./geo-delta";
import { LodController } from "./lod";
import { Topology } from "./topology";
import {
  UnderlayLayers,
  defaultCorners,
  uploadImage,
  type Underlay,
} from "./underlay";

const BASE = serverBase();
// Map palette, drawn from the shared theme. Unowned land has to read clearly
// as land against the near-black sea - that was the "why is Denmark black"
// complaint - without competing with the amber that marks controlled ground.
const SEA = "#0d0e0f";
const UNOWNED = "#31333a";
const PROVINCE_HAIRLINE = "#17181b";
const BORDER_LINE = "#f2f1ee";
const COAST_LINE = "#63676e";
// The shore of land nobody holds. Dim enough to stay scenery, present enough
// that the coast reads as a drawn line rather than as where a fill stops.
const COAST_UNOWNED = "#4a4e57";
const MIN_RING_AREA = 1e-7; // squared degrees; below this a "shape" is a misclick

type Tool = "paint" | "draw" | "erase";

interface Country {
  name: string;
  color: string;
}

// Country colours are data, not theme - admins pick them - but the defaults
// start from the accent so a fresh map looks like the rest of the system.
const PALETTE = [
  "#e8a13c", "#c9552f", "#5d8aa8", "#7d9b4e", "#8a5cd6",
  "#2fa8b8", "#b8574f", "#a67c3d", "#6b7f9e", "#9c6f4e",
];

function randomName(): string {
  const a = ["Северный", "Южный", "Вольный", "Красный", "Стальной", "Тёмный"];
  const b = ["Альянс", "Протокол", "Союз", "Блок", "Картель", "Синдикат"];
  return `${a[(Math.random() * a.length) | 0]} ${b[(Math.random() * b.length) | 0]}`;
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  const list = document.getElementById("countries")!;
  const hover = document.getElementById("hover")!;
  const timing = document.getElementById("timing")!;
  const presence = document.getElementById("presence")!;
  const geoStats = document.getElementById("geo-stats")!;
  const lodStatus = document.getElementById("lod")!;
  const underlayList = document.getElementById("underlays")!;
  const hint = document.getElementById("hint")!;

  status.textContent = "загрузка топологии…";
  const topology = await Topology.load(`${BASE}/geo`, "lod3");
  const describe = () => `${topology.provinces.length} провинций, ${topology.arcCount} дуг`;
  status.textContent = describe();

  const collab = new CollabClient(collabUrl("map-proto"));
  const owners = collab.doc.getMap<string>("owners");          // ProvId -> country id
  const countries = collab.doc.getMap<Country>("countries");   // country id -> {name,color}
  const drawn = collab.doc.getMap<DrawnProvince>("drawn");     // ProvId -> traced polygon
  const deleted = collab.doc.getMap<true>("deleted");          // ProvId -> hidden
  const underlays = collab.doc.getMap<Underlay>("underlays");  // id -> reference image

  // Which underlays *this* user has switched off. Local on purpose - a
  // reference image is a working aid, not part of the map everyone sees.
  const hiddenUnderlays = new Set<string>();

  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {},
      // No glyphs entry at all - MapLibre rejects an explicit undefined, and
      // this prototype draws no labels, so nothing needs a font.
      layers: [{ id: "bg", type: "background", paint: { "background-color": SEA } }],
    },
    center: [15, 48],
    zoom: 4,
    attributionControl: false,
    doubleClickZoom: false, // double-click closes a traced shape
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  await map.once("load");

  const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  map.addSource("provinces", {
    type: "geojson",
    data: topology.provincePolygons(),
    promoteId: "fid",
  });
  // The same provinces, re-emitted from refined geometry. Kept in its own
  // source because it is small and reset often: pushing a refinement through
  // the whole-world source would re-tile 3409 features to change a dozen.
  map.addSource("provinces-detail", { type: "geojson", data: EMPTY, promoteId: "fid" });
  map.addSource("coast", { type: "geojson", data: EMPTY });
  map.addSource("coast-detail", { type: "geojson", data: EMPTY });
  map.addSource("drawn", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    // No promoteId here: drawn features carry a numeric `id` of their own
    // (hashId of the string province id), and feature-state is addressed by
    // that. Promoting the string "prov" property instead would shadow it and
    // silently break every setFeatureState call.
  });
  map.addSource("borders", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("sketch", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Ownership colour is carried in feature-state, so repainting a province is
  // a state write rather than a data reupload.
  const fillPaint = (): maplibregl.FillLayerSpecification["paint"] => ({
    "fill-color": ["coalesce", ["feature-state", "color"], UNOWNED],
    "fill-opacity": 0.85,
  });

  const hairlinePaint = (): maplibregl.LineLayerSpecification["paint"] => ({
    "line-color": PROVINCE_HAIRLINE,
    "line-width": 0.4,
    "line-opacity": 0.7,
  });

  // The shoreline is one line drawn twice: whole-world in `coast`, and again in
  // `coast-detail` for the arcs a refinement replaced. Identical paint, because
  // the seam between them must be invisible.
  const coastPaint = (): maplibregl.LineLayerSpecification["paint"] => ({
    "line-color": COAST_UNOWNED,
    "line-width": 0.7,
    "line-opacity": 0.8,
  });
  const coastLayout: maplibregl.LineLayerSpecification["layout"] = {
    "line-join": "round",
    "line-cap": "round",
  };

  map.addLayer({ id: "province-fill", type: "fill", source: "provinces", paint: fillPaint() });
  map.addLayer({
    id: "province-hairline",
    type: "line",
    source: "provinces",
    paint: hairlinePaint(),
  });
  map.addLayer({
    id: "detail-fill",
    type: "fill",
    source: "provinces-detail",
    paint: fillPaint(),
  });
  map.addLayer({
    id: "detail-hairline",
    type: "line",
    source: "provinces-detail",
    paint: hairlinePaint(),
  });
  map.addLayer({ id: "drawn-fill", type: "fill", source: "drawn", paint: fillPaint() });
  map.addLayer({
    id: "coast-line",
    type: "line",
    source: "coast",
    layout: coastLayout,
    paint: coastPaint(),
  });
  map.addLayer({
    id: "coast-detail-line",
    type: "line",
    source: "coast-detail",
    layout: coastLayout,
    paint: coastPaint(),
  });
  map.addLayer({
    id: "border-line",
    type: "line",
    source: "borders",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["case", ["get", "coast"], COAST_LINE, BORDER_LINE],
      "line-width": ["case", ["get", "coast"], 0.9, 1.8],
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: "sketch-line",
    type: "line",
    source: "sketch",
    paint: { "line-color": "#e8a13c", "line-width": 1.6, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "sketch-vertex",
    type: "circle",
    source: "sketch",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#e8a13c",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#0008",
    },
  });

  // ---- derived state -----------------------------------------------------

  function effective(): EffectiveGeo {
    return new EffectiveGeo(
      topology,
      new Set<ProvId>(deleted.keys()),
      new Map<ProvId, DrawnProvince>(drawn.entries()),
    );
  }

  const ownerOf = (id: ProvId): string | null => owners.get(id) ?? null;

  function colorFor(id: ProvId): string | null {
    const country = ownerOf(id);
    return country ? countries.get(country)?.color ?? null : null;
  }

  /**
   * Provinces currently drawn from refined geometry.
   *
   * A province lives in exactly one of the two sources at a time: the refined
   * copy is drawn and the coarse original is filtered out from under it, so
   * neither the coarse outline nor a doubled fill shows through.
   */
  let detailed: ReadonlySet<number> = new Set();
  let refinedArcs: readonly number[] = [];
  let baseSwapMs = 0;

  /**
   * Ownership colour lives in feature-state, and feature-state is per source -
   * so a province that may move between the base and the detail source has its
   * colour written to both. Writing state for a feature a source does not
   * currently hold is harmless: MapLibre keeps it keyed by id and applies it if
   * and when the feature appears.
   */
  function paintProvince(id: ProvId): void {
    const color = colorFor(id);
    if (isDrawn(id)) {
      map.setFeatureState({ source: "drawn", id: hashId(id) }, { color });
      return;
    }
    const fid = topology.provinces[Number(id)]!.fid;
    map.setFeatureState({ source: "provinces", id: fid }, { color });
    map.setFeatureState({ source: "provinces-detail", id: fid }, { color });
  }

  /** Base layers must not draw a province that the detail source is drawing. */
  function applyBaseFilter(hidden: number[]): void {
    const excluded = detailed.size ? [...hidden, ...detailed] : hidden;
    const filter: maplibregl.FilterSpecification | null = excluded.length
      ? ["!", ["in", ["get", "prov"], ["literal", excluded]]]
      : null;
    map.setFilter("province-fill", filter);
    map.setFilter("province-hairline", filter);
  }

  let frame: number | null = null;
  function refresh(): void {
    // Several provinces can change in one stroke; deriving once per frame keeps
    // it to a single pass regardless of how many.
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const geo = effective();
      const started = performance.now();
      const borders = geo.borderLines(ownerOf);
      const elapsed = performance.now() - started;

      (map.getSource("borders") as maplibregl.GeoJSONSource).setData(borders);
      (map.getSource("drawn") as maplibregl.GeoJSONSource).setData(geo.drawnFeatures());
      applyBaseFilter(geo.hiddenBaseIndices());

      for (const id of drawn.keys()) paintProvince(id);

      const s = geo.stats();
      timing.textContent = `границы: ${borders.features.length} дуг за ${elapsed.toFixed(1)} мс`;
      geoStats.textContent = `база ${s.base} · нарисовано ${s.drawn} · скрыто ${s.hidden}`;
    });
  }

  /**
   * The whole world's shoreline. Twenty-odd thousand arcs, so this is only
   * rebuilt when the shapes themselves change - a base LOD swap, an erased
   * province, a traced island - and never on a paint stroke or a pan.
   */
  function refreshCoast(): void {
    const geo = effective();
    (map.getSource("coast") as maplibregl.GeoJSONSource).setData(geo.coastLines());
  }

  /**
   * Re-derive the geometry that a refinement changed.
   *
   * Everything here is viewport-sized. The whole-world sources are left alone
   * and simply told not to draw what the detail sources are drawing, which is a
   * filter change rather than a reupload - the difference between a pan costing
   * a millisecond and costing a re-tile of the planet.
   */
  function refreshDetail(): void {
    const geo = effective();
    (map.getSource("provinces-detail") as maplibregl.GeoJSONSource).setData(
      detailed.size ? topology.provincePolygons(detailed) : EMPTY,
    );
    (map.getSource("coast-detail") as maplibregl.GeoJSONSource).setData(
      refinedArcs.length ? geo.coastLines(refinedArcs) : EMPTY,
    );
    map.setFilter(
      "coast-line",
      refinedArcs.length ? ["!", ["in", ["get", "arc"], ["literal", [...refinedArcs]]]] : null,
    );
    for (const prov of detailed) paintProvince(String(prov));
    applyBaseFilter(geo.hiddenBaseIndices());
    refresh();
  }

  /** Shapes changed for a reason that is not the LOD: redo both halves. */
  function refreshGeometry(): void {
    refreshCoast();
    refreshDetail();
  }

  function repaintAll(): void {
    for (let i = 0; i < topology.provinces.length; i++) paintProvince(String(i));
    refresh();
  }

  owners.observe((event: Y.YMapEvent<string>) => {
    for (const key of event.keysChanged) paintProvince(key);
    refresh();
    renderCountryList();
  });
  countries.observe(() => {
    repaintAll();
    renderCountryList();
  });
  drawn.observe(() => refreshGeometry());
  deleted.observe(() => refreshGeometry());

  // ---- level of detail ----------------------------------------------------

  const lod = new LodController(map, topology, BASE, {
    onBase: (level) => {
      // A finer base means every outline changed, so the whole-world source is
      // reuploaded and the coastline re-derived. This is the one expensive
      // moment in the whole scheme, which is why it is a one-way upgrade that
      // happens at most once per level per session - zooming back out keeps
      // the finer geometry rather than paying this again in reverse.
      const started = performance.now();
      (map.getSource("provinces") as maplibregl.GeoJSONSource).setData(
        topology.provincePolygons(),
      );
      repaintAll();
      refreshGeometry();
      baseSwapMs = performance.now() - started;
      console.info(`base LOD -> ${level} re-derived in ${baseSwapMs.toFixed(0)} ms`);
    },
    onRefined: (provinces, arcs) => {
      detailed = provinces;
      refinedArcs = arcs;
      refreshDetail();
    },
    onStatus: (text) => {
      lodStatus.textContent = text;
    },
  });

  // ---- reference underlays -----------------------------------------------

  const underlayLayers = new UnderlayLayers(map, BASE, (id, corners) => {
    const current = underlays.get(id);
    if (current) underlays.set(id, { ...current, corners });
  });

  function syncUnderlays(): void {
    underlayLayers.sync(new Map(underlays.entries()), hiddenUnderlays);
    renderUnderlayList();
  }

  function renderUnderlayList(): void {
    underlayList.replaceChildren();
    for (const [id, underlay] of underlays) {
      const row = document.createElement("div");
      row.className = "underlay" + (underlayLayers.selectedId === id ? " active" : "");

      const title = document.createElement("button");
      title.className = "underlay-name";
      title.textContent = underlay.name;
      title.title = "выделить и показать угловые ручки";
      title.onclick = () => {
        underlayLayers.select(underlayLayers.selectedId === id ? null : id);
        syncUnderlays();
      };

      const eye = document.createElement("button");
      eye.className = "icon";
      eye.textContent = hiddenUnderlays.has(id) ? "○" : "●";
      eye.title = "показать/скрыть только у себя";
      eye.onclick = () => {
        if (hiddenUnderlays.has(id)) hiddenUnderlays.delete(id);
        else hiddenUnderlays.add(id);
        syncUnderlays();
      };

      const lock = document.createElement("button");
      lock.className = "icon";
      lock.textContent = underlay.locked ? "🔒" : "🔓";
      lock.title = "зафиксировать положение";
      lock.onclick = () => underlays.set(id, { ...underlay, locked: !underlay.locked });

      const remove = document.createElement("button");
      remove.className = "icon";
      remove.textContent = "✕";
      remove.title = "убрать подложку";
      remove.onclick = () => underlays.delete(id);

      const opacity = document.createElement("input");
      opacity.type = "range";
      opacity.min = "0";
      opacity.max = "1";
      opacity.step = "0.05";
      opacity.value = String(underlay.opacity);
      opacity.oninput = () => {
        // Live feedback without flooding the document; the commit lands on change.
        map.setPaintProperty(`underlay:${id}`, "raster-opacity", Number(opacity.value));
      };
      opacity.onchange = () =>
        underlays.set(id, { ...underlays.get(id)!, opacity: Number(opacity.value) });

      const head = document.createElement("div");
      head.className = "underlay-head";
      head.append(title, eye, lock, remove);
      row.append(head, opacity);
      underlayList.append(row);
    }
  }

  underlays.observe(() => syncUnderlays());

  const fileInput = document.getElementById("underlay-file") as HTMLInputElement;
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    hover.textContent = `загрузка ${file.name}…`;
    try {
      const url = await uploadImage(BASE, file);
      const id = crypto.randomUUID().slice(0, 8);
      underlays.set(id, {
        name: file.name,
        url,
        corners: defaultCorners(map),
        opacity: 0.7,
        locked: false,
      });
      underlayLayers.select(id);
      syncUnderlays();
      hover.textContent = `подложка добавлена: ${file.name}`;
    } catch (error) {
      hover.textContent = `не удалось загрузить: ${(error as Error).message}`;
    } finally {
      fileInput.value = "";
    }
  };

  // ---- tools -------------------------------------------------------------

  let tool: Tool = "paint";
  let brush: string | null = null;
  let sketch: [number, number][] = [];

  function setTool(next: Tool): void {
    tool = next;
    if (next !== "draw") clearSketch();
    for (const button of document.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.classList.toggle("active", button.dataset.tool === next);
    }
    hint.textContent = {
      paint: "Выберите страну и кликайте по провинциям. Вторая вкладка увидит то же самое.",
      draw: "Кликайте по контуру острова. Двойной клик или Enter — замкнуть, Esc — отменить.",
      erase: "Кликните по провинции, чтобы убрать её с карты. Соседи получат береговую линию.",
    }[next];
    map.getCanvas().style.cursor = next === "paint" ? "" : "crosshair";
  }

  function renderSketch(): void {
    const features: GeoJSON.Feature[] = sketch.map((point) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: point },
    }));
    if (sketch.length > 1) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sketch },
      });
    }
    (map.getSource("sketch") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }

  function clearSketch(): void {
    sketch = [];
    renderSketch();
  }

  function commitSketch(): void {
    if (sketch.length < 3) {
      clearSketch();
      return;
    }
    const ring: [number, number][] = [...sketch, sketch[0]!];
    if (ringArea(ring) < MIN_RING_AREA) {
      hover.textContent = "слишком мелкий контур — отменено";
      clearSketch();
      return;
    }
    const id: ProvId = `c:${crypto.randomUUID().slice(0, 8)}`;
    collab.doc.transact(() => {
      drawn.set(id, { name: `Новая территория ${drawn.size + 1}`, ring });
      if (brush) owners.set(id, brush);
    });
    clearSketch();
  }

  map.on("click", (event) => {
    if (tool !== "draw") return;
    sketch.push([event.lngLat.lng, event.lngLat.lat]);
    renderSketch();
  });
  map.on("dblclick", () => {
    if (tool === "draw") commitSketch();
  });
  window.addEventListener("keydown", (event) => {
    if (tool !== "draw") return;
    if (event.key === "Enter") commitSketch();
    if (event.key === "Escape") clearSketch();
  });

  function provinceAt(event: maplibregl.MapMouseEvent): ProvId | null {
    const hits = map.queryRenderedFeatures(event.point, {
      layers: ["drawn-fill", "detail-fill", "province-fill"],
    });
    const feature = hits[0];
    if (!feature) return null;
    const prov = feature.properties?.prov;
    return prov === undefined ? null : String(prov);
  }

  map.on("click", (event) => {
    if (tool === "draw") return;
    const id = provinceAt(event);
    if (id === null) return;

    collab.doc.transact(() => {
      if (tool === "erase") {
        deleted.set(id, true);
        owners.delete(id);
        return;
      }
      if (brush === null) owners.delete(id);
      else owners.set(id, brush);
    });
  });

  map.on("mousemove", (event) => {
    if (tool === "draw") {
      hover.textContent = `точек в контуре: ${sketch.length}`;
      return;
    }
    const id = provinceAt(event);
    if (id === null) {
      hover.textContent = "";
      return;
    }
    const name = id.startsWith("c:")
      ? drawn.get(id)?.name ?? "нарисованная"
      : `${topology.provinces[Number(id)]!.name} · ${topology.provinces[Number(id)]!.group}`;
    const country = ownerOf(id);
    hover.textContent = name + (country ? ` → ${countries.get(country)?.name}` : "");
    collab.awareness.setLocalStateField("hover", { id, name });
  });

  for (const button of document.querySelectorAll<HTMLElement>("[data-tool]")) {
    button.onclick = () => setTool(button.dataset.tool as Tool);
  }

  // ---- country list ------------------------------------------------------

  function renderCountryList(): void {
    const counts = new Map<string, number>();
    for (const id of owners.values()) counts.set(id, (counts.get(id) ?? 0) + 1);

    list.replaceChildren();
    const makeRow = (id: string | null, name: string, color: string, count: number) => {
      const row = document.createElement("button");
      row.className = "country" + (brush === id ? " active" : "");
      row.innerHTML =
        `<span class="swatch" style="background:${color}"></span>` +
        `<span class="name"></span><span class="count">${count || ""}</span>`;
      row.querySelector(".name")!.textContent = name;
      row.onclick = () => {
        brush = id;
        renderCountryList();
      };
      list.append(row);
    };

    makeRow(null, "— ничей (стереть)", UNOWNED, 0);
    for (const [id, country] of countries) {
      makeRow(id, country.name, country.color, counts.get(id) ?? 0);
    }
  }

  document.getElementById("add-country")!.onclick = () => {
    const id = crypto.randomUUID().slice(0, 8);
    countries.set(id, {
      name: randomName(),
      color: PALETTE[countries.size % PALETTE.length]!,
    });
    brush = id;
    renderCountryList();
  };

  collab.awareness.on("change", () => {
    const others = [...collab.awareness.getStates().entries()].filter(
      ([id]) => id !== collab.doc.clientID,
    );
    presence.textContent =
      others.length === 0
        ? "только вы"
        : `ещё ${others.length} на карте` +
          (others[0]?.[1]?.hover ? ` · смотрит: ${others[0][1].hover.name}` : "");
  });

  collab.onStateChange = (state: ConnectionState) => {
    status.dataset.state = state;
    status.textContent = {
      connecting: "подключение…",
      online: describe(),
      offline: "нет связи, переподключаюсь…",
    }[state];
  };

  // Handles for the verification scripts in tools/ - they need to drive the
  // map camera and clear state between runs.
  Object.assign(window as unknown as Record<string, unknown>, {
    __map: map,
    __setTool: setTool,
    __lod: () => ({
      base: topology.level,
      target: lod.targetLevel(),
      refinedArcs: topology.refinedCount,
      vertices: topology.vertexCount(),
      detailedProvinces: detailed.size,
      baseSwapMs: Math.round(baseSwapMs),
    }),
    __underlays: () => JSON.stringify([...underlays.entries()]),
    __reset: () =>
      collab.doc.transact(() => {
        owners.clear();
        countries.clear();
        drawn.clear();
        deleted.clear();
        underlays.clear();
      }),
  });

  setTool("paint");
  syncUnderlays();
  repaintAll();
  refreshGeometry();
  renderCountryList();
  void lod.start();
}

void main();
