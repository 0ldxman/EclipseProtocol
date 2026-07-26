"""Stage 3: build levels of detail by simplifying arcs, not polygons.

This is the step that normally ruins simplified maps. Simplify each province
polygon on its own and two neighbours thin their shared border differently -
the lines drift apart and the map fills with slivers and gaps. Because stage 2
turned the boundary into arcs that both neighbours *reference*, simplifying an
arc once means both sides get the exact same line and the topology survives by
construction.

Douglas-Peucker comes from shapely (C, so this stays fast); endpoints of every
arc are preserved by the algorithm, which keeps junctions pinned and stops
neighbouring arcs from parting company at their shared ends.

Tolerance is adaptive, and that matters more than it sounds. A fixed tolerance
destroys anything smaller than itself: an island narrower than the tolerance
collapses to a two-point line, stops being a polygon and vanishes from the map
entirely. At a flat 0.02 deg that removed 20 305 of 26 947 land parts and made
181 provinces disappear outright - the Maldives, the Marshall Islands, the
Bahamas, the Danish archipelago. So each arc is simplified relative to its own
size instead, which leaves small islands recognisable while still thinning the
long mainland boundaries that actually carry the weight.

Arcs that would collapse below 2 points are kept as a straight endpoint-to-
endpoint segment rather than dropped: dropping one would punch a hole in every
ring that references it. A *closed* arc (an island's whole outline) that ends up
with fewer than 4 points is restored to full precision - it is tiny by
definition, so it costs nothing, and anything less is not a polygon.
"""

import json
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

ROOT = Path("/config/workspace/aether")
IN_ARCS = ROOT / "data/arcs.npz"
IN_PARSED = ROOT / "data/parsed.npz"
OUT_NPZ = ROOT / "data/arcs_lod.npz"
OUT_REPORT = ROOT / "data/lod-report.json"

# An arc is never simplified by more than 1/SIZE_RATIO of its own extent, so
# small islands keep their shape instead of collapsing into a line.
SIZE_RATIO = 10.0

# degrees; ~111 km per degree at the equator
LODS = [
    ("lod0", 0.0),      # untouched, for maximum zoom
    ("lod1", 0.0005),   # ~55 m
    ("lod2", 0.005),    # ~550 m
    ("lod3", 0.02),     # ~2.2 km, overview zooms
]


def main() -> None:
    print(f"loading {IN_ARCS} ...", flush=True)
    az = np.load(IN_ARCS)
    arc_flat = az["arc_flat"]
    arc_off = az["arc_off"]
    coords = np.load(IN_PARSED)["coords"]
    n_arcs = len(arc_off) - 1
    print(f"  {n_arcs:,} arcs, {len(arc_flat):,} vertices", flush=True)

    out: dict[str, np.ndarray] = {}
    report: list[dict] = []

    for name, tol in LODS:
        if tol == 0.0:
            xy = coords[arc_flat]
            out[f"{name}_xy"] = xy.astype(np.float32)
            out[f"{name}_off"] = arc_off.astype(np.int64)
            report.append({"lod": name, "tolerance_deg": tol,
                           "vertices": int(len(arc_flat)),
                           "kept_pct": 100.0})
            print(f"  {name}: {len(arc_flat):,} vertices (source)", flush=True)
            continue

        pieces: list[np.ndarray] = []
        offsets = np.zeros(n_arcs + 1, dtype=np.int64)
        rescued = 0
        for i in range(n_arcs):
            pts = coords[arc_flat[arc_off[i]:arc_off[i + 1]]]
            if len(pts) > 2:
                # np.ptp, not ndarray.ptp - the method was removed in numpy 2.
                extent = max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]))
                # Never thin a feature by more than a tenth of its own size.
                effective = min(tol, extent / SIZE_RATIO) if extent > 0 else tol
                # preserve_topology=True: the plain Douglas-Peucker variant is
                # free to produce a line that crosses itself, which on a coast
                # shows up as a long thin spike stabbing across a bay. The
                # topology-preserving variant costs a few percent more vertices
                # and cannot self-intersect.
                simplified = np.asarray(
                    LineString(pts).simplify(effective, preserve_topology=True).coords)
                closed = bool(pts[0][0] == pts[-1][0] and pts[0][1] == pts[-1][1])
                if closed and len(simplified) < 4:
                    simplified = pts
                    rescued += 1
                elif len(simplified) < 2:
                    simplified = pts[[0, -1]]
            else:
                simplified = pts
            pieces.append(simplified)
            offsets[i + 1] = offsets[i] + len(simplified)

            if (i + 1) % 20000 == 0:
                print(f"    ... {i+1}/{n_arcs} arcs", flush=True)

        xy = np.concatenate(pieces).astype(np.float32)
        out[f"{name}_xy"] = xy
        out[f"{name}_off"] = offsets
        kept = 100.0 * len(xy) / max(len(arc_flat), 1)
        report.append({"lod": name, "tolerance_deg": tol,
                       "vertices": int(len(xy)), "kept_pct": round(kept, 2),
                       "rescued_small_rings": rescued})
        print(f"  {name}: {len(xy):,} vertices ({kept:.1f}% of source), "
              f"{rescued:,} small closed arcs kept at full precision", flush=True)

    np.savez_compressed(OUT_NPZ, **out)
    OUT_REPORT.write_text(json.dumps(report, indent=1), encoding="utf-8")

    print()
    print("=" * 64)
    for r in report:
        approx_mb = r["vertices"] * 8 / 1e6   # 2 x float32 per vertex
        print(f"  {r['lod']:>5}  tol={r['tolerance_deg']:<7} "
              f"{r['vertices']:>10,} vertices  ~{approx_mb:6.1f} MB raw")
    print(f"wrote {OUT_NPZ} ({OUT_NPZ.stat().st_size / 1e6:.1f} MB)")
    print("=" * 64)


if __name__ == "__main__":
    main()
