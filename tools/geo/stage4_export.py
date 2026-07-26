"""Stage 4: pack the topology into a runtime bundle the browser can fetch.

Layout is one binary blob plus a small JSON header describing the typed-array
views inside it, so the client does a single fetch, wraps the ArrayBuffer and
is done - no parsing, no per-feature object allocation.

Coordinates are quantised to 1e-6 deg (~10 cm, far finer than any LOD tolerance
here) and delta-encoded within each arc. Deltas are small and repetitive, which
is what makes the blob compress well over the wire; absolute int32 coordinates
would not.

Before writing anything this reconstructs every ring from its arc references
and compares it to the original ring recorded in stage 1. Arc cutting and
reversal are exactly the kind of thing that goes subtly wrong and only shows up
later as a province with a torn edge, so the bundle is only written if the
reconstruction is exact.
"""

import json
from pathlib import Path

import numpy as np

ROOT = Path("/config/workspace/aether")
IN_PARSED = ROOT / "data/parsed.npz"
IN_ARCS = ROOT / "data/arcs.npz"
IN_LOD = ROOT / "data/arcs_lod.npz"
IN_META = ROOT / "data/provinces.json"
OUT_DIR = ROOT / "data/runtime"

QUANT = 1e-6
EXPORT_LODS = ["lod2", "lod3"]


def verify_reconstruction(parsed, arcs) -> tuple[bool, str]:
    """Rebuild every ring from its arcs and compare with the stage-1 original."""
    ring_pts = parsed["ring_pts"]
    ring_off = parsed["ring_off"]
    arc_flat = arcs["arc_flat"]
    arc_off = arcs["arc_off"]
    ring_arc_flat = arcs["ring_arc_flat"]
    ring_arc_off = arcs["ring_arc_off"]
    n_rings = len(ring_off) - 1

    for r in range(n_rings):
        refs = ring_arc_flat[ring_arc_off[r]:ring_arc_off[r + 1]]
        rebuilt: list[int] = []
        for ref in refs:
            i = int(ref)
            if i < 0:
                seq = arc_flat[arc_off[~i]:arc_off[~i + 1]][::-1]
            else:
                seq = arc_flat[arc_off[i]:arc_off[i + 1]]
            rebuilt.extend(seq[1:] if rebuilt else seq)

        original = ring_pts[ring_off[r]:ring_off[r + 1]]
        rebuilt_arr = np.asarray(rebuilt, dtype=np.int32)

        # A ring is a cycle, so reconstruction may legitimately start at a
        # different vertex; compare as cycles (drop the repeated closing point,
        # then rotate the original onto the rebuilt start).
        a = rebuilt_arr[:-1] if rebuilt_arr[0] == rebuilt_arr[-1] else rebuilt_arr
        b = original[:-1] if original[0] == original[-1] else original
        if len(a) != len(b):
            return False, f"ring {r}: length {len(a)} != {len(b)}"
        where = np.flatnonzero(b == a[0])
        if not len(where):
            return False, f"ring {r}: start vertex {a[0]} not found in original"
        if not any(np.array_equal(np.roll(b, -int(s)), a) for s in where):
            return False, f"ring {r}: vertex sequence differs"
    return True, f"all {n_rings} rings reconstruct exactly"


def main() -> None:
    parsed = np.load(IN_PARSED)
    arcs = np.load(IN_ARCS)
    lods = np.load(IN_LOD)
    provinces = json.loads(IN_META.read_text(encoding="utf-8"))

    print("verifying arc reconstruction ...", flush=True)
    ok, msg = verify_reconstruction(parsed, arcs)
    print(f"  {'OK' if ok else 'FAILED'}: {msg}", flush=True)
    if not ok:
        raise SystemExit("reconstruction check failed - not writing bundle")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ring_prov = parsed["ring_prov"]
    ring_hole = parsed["ring_hole"]

    for lod in EXPORT_LODS:
        xy = lods[f"{lod}_xy"]
        off = lods[f"{lod}_off"].astype(np.int32)

        q = np.round(xy.astype(np.float64) / QUANT).astype(np.int64)
        delta = q.copy()
        # delta-encode inside each arc; first vertex of an arc stays absolute
        starts = off[:-1].astype(np.int64)
        mask = np.ones(len(q), dtype=bool)
        mask[starts] = False
        delta[mask] = q[mask] - q[np.flatnonzero(mask) - 1]
        if np.abs(delta).max() > 2**31 - 1:
            raise SystemExit(f"{lod}: delta overflows int32")
        delta32 = delta.astype(np.int32)

        buffers = {
            "arc_xy": delta32.reshape(-1),
            "arc_off": off,
            "arc_left": arcs["arc_left"].astype(np.int32),
            "arc_right": arcs["arc_right"].astype(np.int32),
            "ring_arc": arcs["ring_arc_flat"].astype(np.int32),
            "ring_arc_off": arcs["ring_arc_off"].astype(np.int32),
            "ring_prov": ring_prov.astype(np.int32),
            # Which polygon part of the province a ring belongs to. Without it
            # the client cannot tell a second *island* from a *hole*: a GeoJSON
            # Polygon treats every ring after the first as a hole, so a province
            # made of many islands would render as one island with the rest
            # punched out of it.
            "ring_part": parsed["ring_part"].astype(np.int32),
            "ring_hole": ring_hole.astype(np.uint8),
        }

        blob = bytearray()
        header_arrays = {}
        for key, arr in buffers.items():
            data = arr.tobytes()
            while len(blob) % 4:            # keep every view 4-byte aligned
                blob.append(0)
            header_arrays[key] = {
                "dtype": str(arr.dtype),
                "byteOffset": len(blob),
                "length": int(arr.size),
            }
            blob.extend(data)

        bin_path = OUT_DIR / f"topology-{lod}.bin"
        bin_path.write_bytes(blob)

        header = {
            "lod": lod,
            "quantization": QUANT,
            "coordEncoding": "delta-int32-per-arc",
            "arcs": int(len(off) - 1),
            "rings": int(len(ring_prov)),
            "provinces": len(provinces),
            "arrays": header_arrays,
            "binary": bin_path.name,
        }
        (OUT_DIR / f"topology-{lod}.json").write_text(
            json.dumps(header, indent=1), encoding="utf-8")
        print(f"  {lod}: {bin_path.stat().st_size/1e6:.1f} MB", flush=True)

    # province table, plus a bbox each for culling and label placement
    coords = parsed["coords"]
    ring_pts = parsed["ring_pts"]
    ring_off = parsed["ring_off"]
    bboxes = np.full((len(provinces), 4), np.nan)
    for r in range(len(ring_prov)):
        if ring_hole[r]:
            continue
        pts = coords[ring_pts[ring_off[r]:ring_off[r + 1]]]
        p = int(ring_prov[r])
        cur = bboxes[p]
        lo = pts.min(axis=0)
        hi = pts.max(axis=0)
        if np.isnan(cur[0]):
            bboxes[p] = [lo[0], lo[1], hi[0], hi[1]]
        else:
            bboxes[p] = [min(cur[0], lo[0]), min(cur[1], lo[1]),
                         max(cur[2], hi[0]), max(cur[3], hi[1])]

    for i, prov in enumerate(provinces):
        prov["bbox"] = [round(float(v), 5) for v in bboxes[i]]
    (OUT_DIR / "provinces.json").write_text(
        json.dumps(provinces, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    review = [p for p in provinces if p.get("name_needs_review")]
    (OUT_DIR / "names-to-review.json").write_text(
        json.dumps([{"fid": p["fid"], "name": p["name"], "group": p["group"]}
                    for p in review], ensure_ascii=False, indent=1),
        encoding="utf-8")

    print()
    print("=" * 64)
    for f in sorted(OUT_DIR.iterdir()):
        print(f"  {f.name:<28} {f.stat().st_size/1e6:8.2f} MB")
    print(f"  names needing manual review : {len(review)}")
    print("=" * 64)


if __name__ == "__main__":
    main()
