"""Stage 1 probe, per-province breakdown.

The global and inland numbers say sharing is high but not why the rest is
unshared. This attributes every segment back to its province, so the shape of
the distribution answers it directly:

  - if unshared segments are *coastline and window edges*, provinces sitting in
    the interior of the sample come out at ~100% shared and only the ones on
    the sample's rim are low;
  - if the layer were actually mis-stitched, low percentages would be scattered
    across interior provinces too.

Holds the sampled provinces in memory (that is why it takes a bbox window),
does one file pass, then reports the distribution plus the worst offenders.
"""

import sys
from collections import Counter
from pathlib import Path

import ijson

SRC = Path("/config/workspace/aether/old/map/backend/data/geo/ECL_Provinces.geojson")
QUANT = 1e-7
LAT_SPAN = 1 << 32

WINDOW = tuple(float(v) for v in (sys.argv[1] if len(sys.argv) > 1
                                  else "8,45.5,28,53").split(","))


def pack_point(x: float, y: float) -> int:
    return (int(round(x / QUANT)) + (1 << 31)) * LAT_SPAN + (int(round(y / QUANT)) + (1 << 31))


def iter_rings(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    polys = [coords] if gtype == "Polygon" else coords if gtype == "MultiPolygon" else []
    for poly in polys:
        for ring in poly:
            yield ring


def main() -> None:
    print(f"window: {WINDOW}", flush=True)

    # fid -> (name, group, [segment keys])
    kept: dict[object, tuple[str, str, list[int]]] = {}
    seg_count: Counter = Counter()

    with SRC.open("rb") as fh:
        for feat in ijson.items(fh, "features.item", use_float=True):
            geom = feat.get("geometry")
            if not geom:
                continue
            props = feat.get("properties") or {}

            xs = [p[0] for ring in iter_rings(geom) for p in ring]
            ys = [p[1] for ring in iter_rings(geom) for p in ring]
            if not xs:
                continue
            if not (min(xs) >= WINDOW[0] and min(ys) >= WINDOW[1]
                    and max(xs) <= WINDOW[2] and max(ys) <= WINDOW[3]):
                continue

            segs: list[int] = []
            for ring in iter_rings(geom):
                prev = None
                for pt in ring:
                    key = pack_point(pt[0], pt[1])
                    if prev is not None and prev != key:
                        sk = (prev << 64) | key if prev < key else (key << 64) | prev
                        segs.append(sk)
                        seg_count[sk] += 1
                    prev = key
            kept[props.get("fid")] = (props.get("shapeName") or "",
                                      props.get("shapeGroup") or "", segs)

    print(f"provinces in window: {len(kept)}", flush=True)

    rows = []
    for fid, (name, group, segs) in kept.items():
        if not segs:
            continue
        shared = sum(1 for sk in segs if seg_count[sk] >= 2)
        rows.append((shared / len(segs), len(segs), fid, group, name))
    rows.sort()

    buckets = Counter()
    for pct, *_ in rows:
        if pct >= 0.99:
            buckets[">=99%"] += 1
        elif pct >= 0.90:
            buckets["90-99%"] += 1
        elif pct >= 0.50:
            buckets["50-90%"] += 1
        else:
            buckets["<50%"] += 1

    print()
    print("=" * 64)
    print("per-province share of segments that a neighbour also uses:")
    for b in (">=99%", "90-99%", "50-90%", "<50%"):
        if buckets[b]:
            print(f"  {b:>7} : {buckets[b]:>4} provinces")
    print()
    print("lowest 12 (expected: provinces on the window rim / with lake shores):")
    for pct, n, fid, group, name in rows[:12]:
        print(f"  {100*pct:5.1f}%  {n:>7} segs  fid={fid} {group} {name}")
    print()
    print("highest 5:")
    for pct, n, fid, group, name in rows[-5:]:
        print(f"  {100*pct:5.1f}%  {n:>7} segs  fid={fid} {group} {name}")
    print("=" * 64)


if __name__ == "__main__":
    main()
