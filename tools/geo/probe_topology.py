"""Stage 1 probe: is the province layer topologically consistent?

The whole "instant borders" design rests on one assumption: where two provinces
touch, they use the *same* boundary points, so a shared edge can be identified
by matching coordinates rather than by intersecting polygons. If that holds we
can extract arcs once and render any country's border by filtering arcs whose
two sides have different controllers - no polygon unions, no server work.

If it does NOT hold (the layer was redrawn and neighbours have independent
vertices along the same border), the design has to change, so this measures it
before anything is built on top.

Two signals, both computed in a single streaming pass at a fixed quantisation:
  points   - how many distinct boundary points are used by >1 province
  segments - how many distinct consecutive point-pairs are used by exactly 2

Segment sharing is the strict test (needs identical vertices AND identical
densification); point sharing is the lenient one. A layer with high point
sharing but low segment sharing is still workable - it just needs a snapping
pass - so the two numbers together say which.
"""

import sys
from collections import Counter
from pathlib import Path

import ijson

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else
           "/config/workspace/aether/old/map/backend/data/geo/ECL_Provinces.geojson")
# 1e-7 deg ~ 1 cm: effectively exact matching, only absorbing float noise.
QUANT = float(sys.argv[2]) if len(sys.argv) > 2 else 1e-7

# Packing a quantised lon/lat into one int keeps the hash tables to plain ints
# instead of tuples - at ~9M segments that is the difference between a couple
# of GB and rather more than this box has.
LAT_SPAN = 1 << 32


def pack_point(x: float, y: float) -> int:
    qx = int(round(x / QUANT))
    qy = int(round(y / QUANT))
    return (qx + (1 << 31)) * LAT_SPAN + (qy + (1 << 31))


def iter_rings(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    polys = [coords] if gtype == "Polygon" else coords if gtype == "MultiPolygon" else []
    for poly in polys:
        for ring in poly:
            yield ring


def ring_bbox(geom):
    xs_min = ys_min = 1e9
    xs_max = ys_max = -1e9
    for ring in iter_rings(geom):
        for x, y in ring:
            xs_min = min(xs_min, x); xs_max = max(xs_max, x)
            ys_min = min(ys_min, y); ys_max = max(ys_max, y)
    return xs_min, ys_min, xs_max, ys_max


def main() -> None:
    # Optional landlocked-window filter: only provinces whose bbox lies fully
    # inside it are considered. On a purely inland subset almost every segment
    # *should* be shared, so this separates "unshared because coastline" from
    # "unshared because neighbours don't line up" - which the global number
    # cannot distinguish on a world with ~27k separate landmass parts.
    window = None
    if "--bbox" in sys.argv:
        window = tuple(float(v) for v in sys.argv[sys.argv.index("--bbox") + 1].split(","))

    print(f"source     : {SRC}", flush=True)
    print(f"quantise   : {QUANT} deg", flush=True)
    if window:
        print(f"bbox filter: {window}  (provinces fully inside only)", flush=True)

    # point key -> number of *distinct provinces* touching it (capped at 3,
    # we only care about 1 / 2 / many)
    point_owner: dict[int, int] = {}   # point -> first fid seen
    point_share: dict[int, int] = {}   # point -> distinct province count (>=2 only)
    seg_count: Counter = Counter()     # segment key -> times seen

    features = 0
    kept = 0
    segments_total = 0

    with SRC.open("rb") as fh:
        for feat in ijson.items(fh, "features.item", use_float=True):
            features += 1
            fid = (feat.get("properties") or {}).get("fid")
            geom = feat.get("geometry")
            if not geom:
                continue

            if window:
                x0, y0, x1, y1 = ring_bbox(geom)
                if not (x0 >= window[0] and y0 >= window[1]
                        and x1 <= window[2] and y1 <= window[3]):
                    continue
                kept += 1

            for ring in iter_rings(geom):
                prev = None
                for pt in ring:
                    key = pack_point(pt[0], pt[1])

                    seen = point_owner.get(key)
                    if seen is None:
                        point_owner[key] = fid
                    elif seen != fid:
                        cur = point_share.get(key)
                        if cur is None:
                            point_share[key] = 2
                            point_owner[key] = fid
                        elif cur < 8:
                            point_share[key] = cur + 1
                            point_owner[key] = fid

                    if prev is not None and prev != key:
                        seg_count[(prev, key) if prev < key else (key, prev)] += 1
                        segments_total += 1
                    prev = key

            if features % 500 == 0:
                print(f"  ... {features} features, {len(point_owner)/1e6:.1f}M points, "
                      f"{len(seg_count)/1e6:.1f}M distinct segments", flush=True)

    distinct_points = len(point_owner)
    shared_points = len(point_share)
    distinct_segments = len(seg_count)
    share_hist = Counter(seg_count.values())

    print()
    print("=" * 64)
    print(f"features            : {features}"
          + (f"   kept by bbox: {kept}" if window else ""))
    print(f"distinct points     : {distinct_points:,}")
    print(f"  used by >1 province: {shared_points:,} "
          f"({100*shared_points/max(distinct_points,1):.1f}%)")
    print()
    print(f"segments (with dupes): {segments_total:,}")
    print(f"distinct segments    : {distinct_segments:,}")
    for times in sorted(share_hist):
        label = {1: "1 (unshared - coast or gap)",
                 2: "2 (shared border - GOOD)"}.get(times, f"{times} (suspicious)")
        n = share_hist[times]
        print(f"  seen {label:<28}: {n:>10,} ({100*n/max(distinct_segments,1):5.1f}%)")
    print()
    shared_seg = share_hist.get(2, 0)
    print(f"VERDICT: {100*shared_seg/max(distinct_segments,1):.1f}% of distinct segments "
          f"are shared by exactly 2 provinces")
    print("=" * 64)


if __name__ == "__main__":
    main()
