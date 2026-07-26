import json
import os
import threading
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session, joinedload
from database import SessionLocal, get_db
from models import Province, Country, Side

# Force shapely's submodules to fully initialize here, synchronously, while
# the app is still single-threaded at import time. Several background
# threads below (geometry warm-up, country points, coastline) each do a
# lazy `from shapely... import ...` the first time they run, and if two of
# them race to import the same shapely submodule for the first time
# concurrently, Python's import machinery can throw a spurious circular-
# import error. Importing it all upfront means later imports just hit the
# module cache, which is race-free.
import shapely.geometry
import shapely.validation
import shapely.ops

router = APIRouter(prefix="/api/map", tags=["map"])

NEUTRAL_COLOR = "#888888"

GEO_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "geo", "ECL_Provinces.geojson")
BORDERS_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "borders_cache.json")
OCCUPIED_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "occupied_cache.json")
COASTLINE_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "coastline_cache.json")


def lighten(hex_color: str, factor: float = 0.5) -> str:
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = int(r + (255 - r) * factor)
    g = int(g + (255 - g) * factor)
    b = int(b + (255 - b) * factor)
    return f"#{r:02x}{g:02x}{b:02x}"


def country_color_for_mode(country: Country, mode: str) -> str:
    if mode == "country":
        return country.color
    if country.side_rel:
        return country.side_rel.color
    if country.sympathy_rel:
        return lighten(country.sympathy_rel.color, 0.5)
    return NEUTRAL_COLOR


def resolve_root(country: Country, by_tag: dict[str, Country]) -> Country:
    seen = {country.tag}
    current = country
    while current.part_of and current.part_of in by_tag and current.part_of not in seen:
        seen.add(current.part_of)
        current = by_tag[current.part_of]
    return current


@router.get("/states")
def get_map_states(
    mode: str = Query("country", pattern="^(country|sides)$"),
    db: Session = Depends(get_db),
):
    countries = (
        db.query(Country)
        .options(joinedload(Country.side_rel), joinedload(Country.sympathy_rel))
        .all()
    )
    by_tag = {c.tag: c for c in countries}
    provinces = db.query(Province).all()

    result = {}
    for p in provinces:
        owner = by_tag.get(p.owner) if p.owner else None
        if not owner:
            continue

        root_owner = resolve_root(owner, by_tag)
        color = country_color_for_mode(root_owner, mode)
        owner_parent = root_owner.tag if root_owner.tag != owner.tag else None

        occupier_color = None
        occupied_by_parent = None
        occupier = by_tag.get(p.occupied_by) if p.occupied_by else None
        if occupier:
            root_occupier = resolve_root(occupier, by_tag)
            occupier_color = country_color_for_mode(root_occupier, mode)
            if root_occupier.tag != occupier.tag:
                occupied_by_parent = root_occupier.tag

        result[p.fid] = {
            "color": color,
            "occupier_color": occupier_color,
            "owner": p.owner,
            "owner_parent": owner_parent,
            "occupied_by": p.occupied_by,
            "occupied_by_parent": occupied_by_parent,
        }

    return result


# ── borders cache ─────────────────────────────────────────────────────────────
#
# Border line geometry is grouped per *controlling* country: an occupied province
# counts toward the occupier's territory, not the original owner's, so the
# front line on the map matches who actually holds the ground. Occupied-zone
# hatch overlays remain keyed by province (fid) regardless of borders.
#
# Province geometry never changes at runtime, so it's loaded once and cached.
# Edits to a single province only ever affect the (at most two) countries that
# controlled it before/after the edit, so we recompute just those countries'
# border polygons instead of redoing the whole map.

_state_lock = threading.Lock()
_borders_result: dict = {"type": "FeatureCollection", "features": []}
_occupied_result: dict = {"type": "FeatureCollection", "features": []}
_border_feature_by_tag: dict[str, dict] = {}
_occupied_feature_by_fid: dict[int, dict] = {}

_geom_by_fid: dict | None = None
_geom_lock = threading.Lock()

_refresh_lock = threading.Lock()
_full_refresh_scheduled = False

# Per-country search points, keyed by the *literal* owner tag — not the
# resolved root used for border grouping. A country that's been fully
# annexed (part_of another) never gets its own border feature (its
# territory is merged into the parent's), but it should still be findable
# by name/tag and jump to where its territory actually is.
_country_point_by_tag: dict[str, dict] = {}
_country_points_result: dict = {}


def _load_geoms() -> dict:
    global _geom_by_fid
    with _geom_lock:
        if _geom_by_fid is not None:
            return _geom_by_fid
        from shapely.geometry import shape
        from shapely.validation import make_valid

        print("[borders] loading geometry...")
        with open(GEO_PATH, encoding="utf-8") as f:
            geo = json.load(f)
        geom_by_fid: dict[int, object] = {}
        for feat in geo["features"]:
            fid = feat["properties"].get("fid")
            if fid is None or not feat.get("geometry"):
                continue
            try:
                geom_by_fid[int(fid)] = make_valid(shape(feat["geometry"]))
            except Exception:
                pass
        _geom_by_fid = geom_by_fid
        return _geom_by_fid


def _controller_state():
    """Current (controller_tag_by_fid, occupied_by_fid, by_tag) from the DB.

    controller_tag is occupied_by when set, else owner — i.e. whoever
    currently holds the province on the ground.
    """
    db = SessionLocal()
    try:
        by_tag = {c.tag: c for c in db.query(Country).all()}
        provinces = db.query(Province).all()
    finally:
        db.close()
    owner_by_fid = {p.fid: p.owner for p in provinces if p.owner}
    occupied_by_fid = {p.fid: p.occupied_by for p in provinces if p.occupied_by}
    controller_by_fid = {**owner_by_fid, **occupied_by_fid}
    return controller_by_fid, occupied_by_fid, by_tag


def _owner_groups() -> dict[str, list[int]]:
    """fids owned by each country, by literal owner tag (ignores part_of and
    occupied_by — this is "whose territory is this on paper", used only to
    place a search point for every country, including annexed ones)."""
    db = SessionLocal()
    try:
        provinces = db.query(Province).all()
    finally:
        db.close()
    groups: dict[str, list[int]] = {}
    for p in provinces:
        if p.owner:
            groups.setdefault(p.owner, []).append(p.fid)
    return groups


def _build_country_point(geoms: list) -> dict | None:
    from shapely import coverage_union_all
    from shapely.ops import unary_union

    try:
        try:
            merged = coverage_union_all(geoms)
        except Exception:
            merged = unary_union(geoms)
        if merged.is_empty:
            return None
        simplified = merged.simplify(0.01, preserve_topology=True)
        geom = simplified
        if geom.geom_type == "MultiPolygon" and len(geom.geoms) > 1:
            geom = max(geom.geoms, key=lambda g: g.area)
        pt = geom.representative_point()
        return {"lng": pt.x, "lat": pt.y}
    except Exception as e:
        print(f"[country-points] skip: {e}")
        return None


def _recompute_country_points(tags: set[str]):
    """Recompute search points for just the given owner tags."""
    global _country_points_result
    if not tags:
        return
    geom_by_fid = _load_geoms()
    owner_groups = _owner_groups()
    with _state_lock:
        for tag in tags:
            fids = owner_groups.get(tag, [])
            geoms = [geom_by_fid[f] for f in fids if f in geom_by_fid and not geom_by_fid[f].is_empty]
            if not geoms:
                _country_point_by_tag.pop(tag, None)
                continue
            pt = _build_country_point(geoms)
            if pt:
                _country_point_by_tag[tag] = pt
            else:
                _country_point_by_tag.pop(tag, None)
        _country_points_result = dict(_country_point_by_tag)


def _build_border_feature(tag: str, geoms: list) -> dict | None:
    from shapely import coverage_union_all
    from shapely.ops import unary_union

    try:
        try:
            merged = coverage_union_all(geoms)
        except Exception:
            merged = unary_union(geoms)
        if merged.is_empty:
            return None
        # Simplify only the result (0.003° ≈ 300m) — not the inputs
        simplified = merged.simplify(0.003, preserve_topology=True)
        # representative_point() on a MultiPolygon can land on any part of it
        # (e.g. a tiny offshore island far from the mainland), so anchor the
        # label to the largest contiguous landmass instead.
        label_geom = simplified
        if label_geom.geom_type == "MultiPolygon" and len(label_geom.geoms) > 1:
            label_geom = max(label_geom.geoms, key=lambda g: g.area)
        pt = label_geom.representative_point()
        # Bounding box of the largest landmass — the frontend renders labels
        # horizontally (no rotation) and fits the text into this box by
        # projecting its corners through the live map view, which already
        # handles zoom and Mercator distortion correctly.
        minx, miny, maxx, maxy = label_geom.bounds
        return {
            "type": "Feature",
            "geometry": simplified.boundary.__geo_interface__,
            "properties": {
                "tag": tag,
                "label_lng": pt.x,
                "label_lat": pt.y,
                "label_minx": minx,
                "label_maxx": maxx,
                "label_miny": miny,
                "label_maxy": maxy,
            },
        }
    except Exception as e:
        print(f"[borders] skip {tag}: {e}")
        return None


def _build_occupied_feature(fid: int, geom) -> dict | None:
    try:
        simplified = geom.simplify(0.001, preserve_topology=True)
        return {"type": "Feature", "geometry": simplified.__geo_interface__, "properties": {"fid": fid}}
    except Exception as e:
        print(f"[borders] skip occupied fid {fid}: {e}")
        return None


def _persist_caches_async():
    """Write the current in-memory results to disk in the background.

    The API never reads these files at runtime — only _startup_load() does,
    on cold start. Serializing the full ~150-country FeatureCollection is
    the slow part of an edit (multiple seconds), so it must never block a
    province save; it just keeps the cold-start cache warm for next boot.
    """
    borders_snapshot, occupied_snapshot = _borders_result, _occupied_result

    def _write():
        with open(BORDERS_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(borders_snapshot, f)
        with open(OCCUPIED_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(occupied_snapshot, f)

    threading.Thread(target=_write, daemon=True).start()


def _recompute_tags(tags: set[str]):
    """Recompute border polygons for the given root-country tags. Scoped to
    just the countries that changed, so it's much cheaper than a full
    refresh — but for a large country (dozens of provinces) the union+
    simplify can still take a second or more, so callers run this off the
    request path (see notify_provinces_changed) rather than inline."""
    global _borders_result
    if not tags:
        return
    geom_by_fid = _load_geoms()
    controller_by_fid, _occ, by_tag = _controller_state()

    groups: dict[str, list] = {tag: [] for tag in tags}
    for fid, controller_tag in controller_by_fid.items():
        controller = by_tag.get(controller_tag)
        if not controller:
            continue
        root_tag = resolve_root(controller, by_tag).tag
        if root_tag not in groups:
            continue
        geom = geom_by_fid.get(fid)
        if geom is not None and not geom.is_empty:
            groups[root_tag].append(geom)

    with _state_lock:
        for tag, geoms in groups.items():
            if not geoms:
                _border_feature_by_tag.pop(tag, None)
                continue
            feature = _build_border_feature(tag, geoms)
            if feature:
                _border_feature_by_tag[tag] = feature
            else:
                _border_feature_by_tag.pop(tag, None)
        _borders_result = {"type": "FeatureCollection", "features": list(_border_feature_by_tag.values())}
        _persist_caches_async()
    print(f"[borders] recomputed {len(tags)} country border(s): {sorted(tags)}")


def notify_provinces_changed(old_states: dict[int, tuple]):
    """Call after committing province owner/occupied_by changes.

    old_states maps fid -> (old_owner, old_occupied_by) captured *before* the
    update was applied. Occupied-zone overlays for the changed fids are
    updated immediately (cheap, per-province). Border-line polygons are only
    recomputed for the countries that actually gained or lost territory.
    """
    global _occupied_result
    if not old_states:
        return

    fids = list(old_states.keys())
    db = SessionLocal()
    try:
        by_tag = {c.tag: c for c in db.query(Country).all()}
        new_provinces = {p.fid: p for p in db.query(Province).filter(Province.fid.in_(fids)).all()}
    finally:
        db.close()

    geom_by_fid = _load_geoms()
    affected_tags: set[str] = set()
    affected_owner_tags: set[str] = set()
    occupied_updates: dict[int, dict | None] = {}

    for fid, (old_owner, old_occupied_by) in old_states.items():
        province = new_provinces.get(fid)
        new_owner = province.owner if province else None
        new_occupied_by = province.occupied_by if province else None

        for controller_tag in (old_owner, old_occupied_by, new_owner, new_occupied_by):
            controller = by_tag.get(controller_tag) if controller_tag else None
            if controller:
                affected_tags.add(resolve_root(controller, by_tag).tag)

        if old_owner:
            affected_owner_tags.add(old_owner)
        if new_owner:
            affected_owner_tags.add(new_owner)

        if new_occupied_by:
            geom = geom_by_fid.get(fid)
            occupied_updates[fid] = _build_occupied_feature(fid, geom) if geom is not None else None
        else:
            occupied_updates[fid] = None

    with _state_lock:
        for fid, feature in occupied_updates.items():
            if feature:
                _occupied_feature_by_fid[fid] = feature
            else:
                _occupied_feature_by_fid.pop(fid, None)
        _occupied_result = {"type": "FeatureCollection", "features": list(_occupied_feature_by_fid.values())}
        if not affected_tags:
            _persist_caches_async()

    # Border-line polygons and search points are each their own union+simplify
    # over every province of the affected countries — for a large country
    # (e.g. ~70 provinces) that's a second or more, which used to sit inline
    # on the request and was the actual source of the multi-second "saving"
    # delay. The owner/occupier colors above already reflect the change (the
    # part the admin UI repaints immediately), so the heavier polygon work
    # can safely happen off to the side; the frontend's next borders/points
    # fetch just briefly serves the pre-edit shape until this thread finishes.
    def _background_recompute():
        _recompute_tags(affected_tags)
        _recompute_country_points(affected_owner_tags)

    threading.Thread(target=_background_recompute, daemon=True).start()


def _do_compute_borders():
    """Full recompute of all borders + occupied zones (cold start / no cache)."""
    global _full_refresh_scheduled, _borders_result, _occupied_result
    try:
        geom_by_fid = _load_geoms()
        controller_by_fid, occupied_by_fid, by_tag = _controller_state()

        print("[borders] computing union for all countries...")
        groups: dict[str, list] = {}
        for fid, controller_tag in controller_by_fid.items():
            controller = by_tag.get(controller_tag)
            if not controller:
                continue
            geom = geom_by_fid.get(fid)
            if geom is None or geom.is_empty:
                continue
            root = resolve_root(controller, by_tag)
            groups.setdefault(root.tag, []).append(geom)

        with _state_lock:
            _border_feature_by_tag.clear()
            for tag, geoms in groups.items():
                feature = _build_border_feature(tag, geoms)
                if feature:
                    _border_feature_by_tag[tag] = feature
            _borders_result = {"type": "FeatureCollection", "features": list(_border_feature_by_tag.values())}

            print(f"[borders] computing {len(occupied_by_fid)} occupied zones...")
            _occupied_feature_by_fid.clear()
            for fid in occupied_by_fid:
                geom = geom_by_fid.get(fid)
                if geom is None or geom.is_empty:
                    continue
                feature = _build_occupied_feature(fid, geom)
                if feature:
                    _occupied_feature_by_fid[fid] = feature
            _occupied_result = {"type": "FeatureCollection", "features": list(_occupied_feature_by_fid.values())}

            _persist_caches_async()

        print("[borders] computing country search points...")
        _recompute_country_points(set(_owner_groups().keys()))

        print(
            f"[borders] done: {len(_border_feature_by_tag)} border features, "
            f"{len(_occupied_feature_by_fid)} occupied zone features"
        )
    except Exception as e:
        print(f"[borders] compute error: {e}")
    finally:
        with _refresh_lock:
            _full_refresh_scheduled = False


def _schedule_borders_refresh():
    global _full_refresh_scheduled
    with _refresh_lock:
        if _full_refresh_scheduled:
            return
        _full_refresh_scheduled = True
    threading.Thread(target=_do_compute_borders, daemon=True).start()


def invalidate_borders_cache():
    """Force a full recompute of every country's borders. Prefer
    notify_provinces_changed() for province edits — this is for cases where
    the whole control structure may have shifted (e.g. country tree edits)."""
    if os.path.exists(BORDERS_CACHE_PATH):
        os.remove(BORDERS_CACHE_PATH)
    if os.path.exists(OCCUPIED_CACHE_PATH):
        os.remove(OCCUPIED_CACHE_PATH)
    _schedule_borders_refresh()


def _startup_load():
    """Load borders/occupied zones from disk cache if available, else compute in background."""
    global _borders_result, _occupied_result
    caches_loaded = False
    try:
        with open(BORDERS_CACHE_PATH, encoding="utf-8") as f:
            _borders_result = json.load(f)
        with open(OCCUPIED_CACHE_PATH, encoding="utf-8") as f:
            _occupied_result = json.load(f)
        for feat in _borders_result.get("features", []):
            tag = feat.get("properties", {}).get("tag")
            if tag:
                _border_feature_by_tag[tag] = feat
        for feat in _occupied_result.get("features", []):
            fid = feat.get("properties", {}).get("fid")
            if fid is not None:
                _occupied_feature_by_fid[fid] = feat
        print(
            f"[borders] loaded from cache: {len(_borders_result['features'])} border features, "
            f"{len(_occupied_result['features'])} occupied zone features"
        )
        caches_loaded = True
    except Exception:
        pass
    if not caches_loaded:
        print("[borders] no cache, computing in background...")
        _schedule_borders_refresh()
    else:
        # Geometry is only loaded lazily on first use; without this, the
        # ~20s parse/validate cost would land on whichever province edit
        # happens to be the first one after a restart. Warm it up now.
        threading.Thread(target=_load_geoms, daemon=True).start()
        # Country search points aren't disk-cached (cheap to recompute,
        # and stale ones would be actively misleading), so always rebuild
        # them in the background on startup.
        threading.Thread(
            target=lambda: _recompute_country_points(set(_owner_groups().keys())), daemon=True
        ).start()


# ── coastline halo ──────────────────────────────────────────────────────────
#
# A thin line offset a fixed *geographic* distance out from the actual
# coastline, so small islands stand out against the ocean background even
# though we don't render a real ocean polygon. Land geometry never changes
# at runtime (no admin edits it), so this is computed once and cached —
# unlike borders/occupied-zones there's no incremental update story.
#
# Built from the *province* geometry (_load_geoms(), same source borders use)
# rather than the coarser land-outline file: the land file only has 178
# simplified landmass shapes and is missing huge numbers of small islands
# (e.g. Pacific atolls) that exist as their own provinces. Buffering all
# ~3400 provinces individually and unioning the results gives full coverage.
#
# A few provinces (e.g. one feature with 4.5M vertices across 23k disjoint
# slivers) are too complex to buffer directly (minutes each). But
# pre-simplifying *everything* the same way destroys exactly what we want to
# keep: small islands collapse to nothing under an aggressive tolerance. So
# pre-simplify (lossy, fast) only kicks in for provinces above a vertex-count
# threshold; small islands are buffered at full precision, which is cheap
# anyway since they're small.
COASTLINE_BUFFER_DEG = 0.2  # ~12 nautical miles (territorial waters) outward offset
COASTLINE_PRE_SIMPLIFY_VERTEX_THRESHOLD = 3000
COASTLINE_PRE_SIMPLIFY_DEG = 0.05
COASTLINE_POST_SIMPLIFY_DEG = 0.02

_coastline_result: dict = {"type": "FeatureCollection", "features": []}


def _geom_vertex_count(geom) -> int:
    if hasattr(geom, "geoms"):
        return sum(len(p.exterior.coords) for p in geom.geoms)
    return len(geom.exterior.coords)


def _compute_coastline():
    global _coastline_result
    try:
        from shapely.ops import unary_union

        print("[coastline] using province geometry...")
        geom_by_fid = _load_geoms()

        buffered_geoms = []
        for fid, g in geom_by_fid.items():
            try:
                if g.is_empty:
                    continue
                if _geom_vertex_count(g) > COASTLINE_PRE_SIMPLIFY_VERTEX_THRESHOLD:
                    g = g.simplify(COASTLINE_PRE_SIMPLIFY_DEG, preserve_topology=False)
                    if g.is_empty:
                        continue
                buffered_geoms.append(g.buffer(COASTLINE_BUFFER_DEG))
            except Exception as e:
                print(f"[coastline] skip fid {fid}: {e}")

        # Nearby islands' buffer zones overlap — union them so the halo
        # around a cluster of islands is one smooth shape instead of a mess
        # of independently-drawn, crisscrossing circles.
        print(f"[coastline] unioning {len(buffered_geoms)} buffered shapes...")
        merged = unary_union(buffered_geoms)
        merged = merged.simplify(COASTLINE_POST_SIMPLIFY_DEG, preserve_topology=False)
        line = merged.boundary

        result = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": line.__geo_interface__, "properties": {}}],
        }
        with open(COASTLINE_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(result, f)
        _coastline_result = result
        print("[coastline] done")
    except Exception as e:
        print(f"[coastline] compute error: {e}")


def _coastline_startup_load():
    global _coastline_result
    try:
        with open(COASTLINE_CACHE_PATH, encoding="utf-8") as f:
            _coastline_result = json.load(f)
        print(f"[coastline] loaded from cache: {len(_coastline_result['features'])} features")
    except Exception:
        print("[coastline] no cache, computing in background...")
        threading.Thread(target=_compute_coastline, daemon=True).start()


_coastline_startup_load()
_startup_load()


@router.get("/coastline")
def get_coastline():
    return JSONResponse(_coastline_result)


@router.get("/borders")
def get_map_borders():
    return JSONResponse(_borders_result)


@router.get("/occupied-zones")
def get_occupied_zones():
    return JSONResponse(_occupied_result)


@router.get("/country-points")
def get_country_points():
    """tag -> {lng, lat} for every country that owns at least one province,
    including ones fully annexed into another country's borders — lets the
    frontend search/jump to a country's territory even if it no longer has
    its own border line on the map."""
    return JSONResponse(_country_points_result)
