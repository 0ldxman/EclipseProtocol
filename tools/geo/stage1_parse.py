"""Stage 1: parse the source province layer into a compact binary cache.

Reading the 326 MB GeoJSON with ijson costs ~4 minutes, which makes iterating on
the later stages painful. This runs once and writes a cache every later stage
loads in a second or two.

What it produces
----------------
data/parsed.npz
    coords     float64 [P, 2]  deduplicated boundary points
    ring_pts   int32   [S]     concatenated point indices of every ring
    ring_off   int64   [R+1]   slice bounds into ring_pts
    ring_prov  int32   [R]     province index each ring belongs to
    ring_part  int32   [R]     polygon-part index within that province
    ring_hole  uint8   [R]     0 = outer ring, 1 = hole

data/provinces.json
    per-province metadata in ring_prov order, with names repaired

Point deduplication uses the same 1e-7 deg quantisation the topology probe
validated, so two provinces sharing a border end up pointing at *the same*
coordinate index. That is what lets stage 2 find shared edges by comparing
integers instead of geometry.

Name repair
-----------
The source has two distinct kinds of export damage, and only one is fixable:
  - double-encoded UTF-8 ("RegiÃ³n" for "Región") - recovered by re-decoding;
  - characters replaced by a literal "?" ("Me?imurje" for "Međimurje") - the
    byte is gone, so these are only counted and listed for manual fixing.
"""

import json
import re
from array import array
from pathlib import Path

import ijson
import numpy as np

ROOT = Path("/config/workspace/aether")
SRC = ROOT / "old/map/backend/data/geo/ECL_Provinces.geojson"
OUT_NPZ = ROOT / "data/parsed.npz"
OUT_META = ROOT / "data/provinces.json"

QUANT = 1e-7
LAT_SPAN = 1 << 32

MOJIBAKE_MARKERS = ("Ã", "Â", "â€")
LOST_CHAR_RE = re.compile(r"\?")


def repair_name(s: str) -> tuple[str, bool, bool]:
    """Return (repaired, was_mojibake, has_lost_chars)."""
    if not s:
        return s, False, False

    original = s
    # Double (or triple) encoding is undone by re-running the same decode until
    # the tell-tale sequences are gone. Bounded so a name that legitimately
    # contains "Â" can never loop.
    for _ in range(3):
        if not any(m in s for m in MOJIBAKE_MARKERS):
            break
        try:
            candidate = s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if candidate == s:
            break
        s = candidate

    return s, s != original, bool(LOST_CHAR_RE.search(s))


def main() -> None:
    print(f"source: {SRC} ({SRC.stat().st_size / 1e6:.0f} MB)", flush=True)

    point_index: dict[int, int] = {}
    xs = array("d")
    ys = array("d")

    ring_pts = array("i")
    ring_off = array("q", [0])
    ring_prov = array("i")
    ring_part = array("i")
    ring_hole = array("B")

    provinces: list[dict] = []
    mojibake_fixed: list[str] = []
    lost_chars: list[str] = []

    with SRC.open("rb") as fh:
        for feat in ijson.items(fh, "features.item", use_float=True):
            geom = feat.get("geometry")
            props = feat.get("properties") or {}
            if not geom:
                continue

            prov_idx = len(provinces)
            name, fixed, lost = repair_name(props.get("shapeName") or "")
            group, gfixed, glost = repair_name(props.get("shapeGroup") or "")
            if fixed:
                mojibake_fixed.append(name)
            if lost:
                lost_chars.append(name)

            provinces.append({
                "fid": props.get("fid"),
                "name": name,
                "group": group,
                "name_needs_review": lost,
            })

            gtype = geom.get("type")
            coords = geom.get("coordinates") or []
            polys = [coords] if gtype == "Polygon" else coords if gtype == "MultiPolygon" else []

            for part_idx, poly in enumerate(polys):
                for ring_idx, ring in enumerate(poly):
                    n_before = len(ring_pts)
                    prev_key = None
                    for pt in ring:
                        key = ((int(round(pt[0] / QUANT)) + (1 << 31)) * LAT_SPAN
                               + (int(round(pt[1] / QUANT)) + (1 << 31)))
                        # Drop consecutive duplicates - they carry no shape and
                        # would produce zero-length segments in stage 2.
                        if key == prev_key:
                            continue
                        prev_key = key

                        idx = point_index.get(key)
                        if idx is None:
                            idx = len(xs)
                            point_index[key] = idx
                            xs.append(pt[0])
                            ys.append(pt[1])
                        ring_pts.append(idx)

                    if len(ring_pts) - n_before < 4:
                        # Degenerate ring (fewer than 3 distinct points plus the
                        # closing one) - nothing renderable, drop it.
                        del ring_pts[n_before:]
                        continue

                    ring_off.append(len(ring_pts))
                    ring_prov.append(prov_idx)
                    ring_part.append(part_idx)
                    ring_hole.append(0 if ring_idx == 0 else 1)

            if len(provinces) % 500 == 0:
                print(f"  ... {len(provinces)} provinces, {len(xs)/1e6:.1f}M points, "
                      f"{len(ring_off)-1} rings", flush=True)

    coords = np.empty((len(xs), 2), dtype=np.float64)
    coords[:, 0] = np.frombuffer(xs, dtype=np.float64)
    coords[:, 1] = np.frombuffer(ys, dtype=np.float64)

    OUT_NPZ.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        OUT_NPZ,
        coords=coords,
        ring_pts=np.frombuffer(ring_pts, dtype=np.int32),
        ring_off=np.frombuffer(ring_off, dtype=np.int64),
        ring_prov=np.frombuffer(ring_prov, dtype=np.int32),
        ring_part=np.frombuffer(ring_part, dtype=np.int32),
        ring_hole=np.frombuffer(ring_hole, dtype=np.uint8),
    )
    OUT_META.write_text(json.dumps(provinces, ensure_ascii=False, indent=1), encoding="utf-8")

    n_rings = len(ring_off) - 1
    print()
    print("=" * 64)
    print(f"provinces        : {len(provinces)}")
    print(f"rings            : {n_rings}")
    print(f"  holes          : {int(np.frombuffer(ring_hole, dtype=np.uint8).sum())}")
    print(f"distinct points  : {len(xs):,}")
    print(f"ring point refs  : {len(ring_pts):,}")
    print()
    print(f"names repaired (double-encoded) : {len(mojibake_fixed)}")
    for n in mojibake_fixed[:8]:
        print(f"    {n}")
    if len(mojibake_fixed) > 8:
        print(f"    ... and {len(mojibake_fixed)-8} more")
    print(f"names with lost characters (?)  : {len(lost_chars)}   <- need manual review")
    for n in lost_chars[:8]:
        print(f"    {n}")
    if len(lost_chars) > 8:
        print(f"    ... and {len(lost_chars)-8} more")
    print()
    print(f"wrote {OUT_NPZ}  ({OUT_NPZ.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {OUT_META} ({OUT_META.stat().st_size / 1e6:.1f} MB)")
    print("=" * 64)


if __name__ == "__main__":
    main()
