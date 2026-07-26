"""Stage 2: cut province rings into shared arcs.

An *arc* is a maximal run of boundary that separates the same two things all
the way along - province A from province B, or province A from open sea. Once
the boundary is expressed as arcs, drawing any country's outline stops being a
geometry problem and becomes a filter:

    draw arc  <=>  controller(arc.left) != controller(arc.right)

which is why painting a province can update the front line instantly in the
browser with no server work at all.

Method
------
Stage 1 already deduplicated points, so two provinces sharing a border refer to
the *same* point indices. Therefore:

1. Every ring segment is normalised to (low_point, high_point) and grouped.
   A group of 2 is a shared border and names both sides; a group of 1 is an
   outer edge (coast, or a hole's rim); anything else is an anomaly.
2. Cut points ("junctions") are where the far side changes - a tri-point where
   three provinces meet, or the transition from a neighbour to open sea. Ring
   start points are junctions too, and they are collected *globally*: a ring's
   start is an interior point of its neighbour's ring, so without sharing the
   set, the two sides would cut differently and their arcs would not match.
3. Each ring is then walked and split at junctions, and identical arcs found
   from both sides are collapsed into one (the second traversal sees it
   reversed, so the canonical key is the direction-independent one).

Output (data/arcs.npz) keeps arcs as point-index sequences, plus each ring
rewritten as a signed sequence of arc references - negative meaning traversed
backwards, encoded as ~i so that index 0 stays addressable.
"""

import json
from pathlib import Path

import numpy as np

ROOT = Path("/config/workspace/aether")
IN_NPZ = ROOT / "data/parsed.npz"
OUT_NPZ = ROOT / "data/arcs.npz"
OUT_REPORT = ROOT / "data/arcs-report.json"

NO_NEIGHBOUR = -1
ANOMALY = -2


def main() -> None:
    print(f"loading {IN_NPZ} ...", flush=True)
    z = np.load(IN_NPZ)
    ring_pts = z["ring_pts"]
    ring_off = z["ring_off"]
    ring_prov = z["ring_prov"]
    n_rings = len(ring_off) - 1
    n_points = len(z["coords"])
    print(f"  {n_rings} rings, {len(ring_pts):,} point refs, {n_points:,} points", flush=True)

    # ---- 1. segments -----------------------------------------------------
    # Segment i of a ring joins ring_pts[k] -> ring_pts[k+1]; the last point of
    # a closed ring repeats the first, so every ring contributes len-1 segments.
    keep = np.ones(len(ring_pts), dtype=bool)
    keep[ring_off[1:] - 1] = False          # drop each ring's final point
    seg_start = np.flatnonzero(keep)
    seg_a = ring_pts[seg_start]
    seg_b = ring_pts[seg_start + 1]

    seg_ring = np.repeat(np.arange(n_rings), np.diff(ring_off) - 1)
    seg_prov = ring_prov[seg_ring]
    n_segs = len(seg_a)
    print(f"  {n_segs:,} segments", flush=True)

    lo = np.minimum(seg_a, seg_b).astype(np.int64)
    hi = np.maximum(seg_a, seg_b).astype(np.int64)
    key = lo * n_points + hi

    order = np.argsort(key, kind="stable")
    skey = key[order]
    sprov = seg_prov[order]

    starts = np.empty(n_segs, dtype=bool)
    starts[0] = True
    starts[1:] = skey[1:] != skey[:-1]
    group = np.cumsum(starts) - 1
    counts = np.bincount(group)
    print(f"  {len(counts):,} distinct segments  "
          f"(shared by 2: {int((counts == 2).sum()):,}, "
          f"unshared: {int((counts == 1).sum()):,}, "
          f"anomalous: {int((counts > 2).sum()):,})", flush=True)

    # For each segment, which province is on the other side.
    partner_sorted = np.full(n_segs, ANOMALY, dtype=np.int32)
    group_start = np.flatnonzero(starts)
    size1 = counts == 1
    size2 = counts == 2
    partner_sorted[group_start[size1]] = NO_NEIGHBOUR
    s2 = group_start[size2]
    partner_sorted[s2] = sprov[s2 + 1]
    partner_sorted[s2 + 1] = sprov[s2]

    partner = np.empty(n_segs, dtype=np.int32)
    partner[order] = partner_sorted

    # ---- 2. junctions ----------------------------------------------------
    is_junction = np.zeros(n_points, dtype=bool)
    # every ring's start/end point
    is_junction[ring_pts[ring_off[:-1]]] = True

    # points where the far side changes between two consecutive segments of a
    # ring - the shared point between segment k-1 and k is seg_a[k]
    seg_pos = np.arange(n_segs) - np.repeat(ring_off[:-1] - np.arange(n_rings), np.diff(ring_off) - 1)
    interior = seg_pos > 0
    changed = np.zeros(n_segs, dtype=bool)
    changed[1:] = partner[1:] != partner[:-1]
    cut_here = interior & changed
    is_junction[seg_a[cut_here]] = True
    print(f"  {int(is_junction.sum()):,} junction points", flush=True)

    # ---- 3. walk rings, split at junctions -------------------------------
    arc_pts: list[np.ndarray] = []
    arc_left: list[int] = []
    arc_right: list[int] = []
    arc_lookup: dict[bytes, int] = {}

    ring_arcs: list[list[int]] = []

    seg_cursor = 0
    for r in range(n_rings):
        lo_i, hi_i = ring_off[r], ring_off[r + 1]
        pts = ring_pts[lo_i:hi_i]
        m = len(pts) - 1
        prov = int(ring_prov[r])
        par = partner[seg_cursor:seg_cursor + m]
        seg_cursor += m

        # Start walking from a junction so arcs never straddle the ring seam.
        jmask = is_junction[pts[:m]]
        start = int(np.argmax(jmask)) if jmask.any() else 0

        refs: list[int] = []
        cur = [int(pts[start])]
        cur_par = int(par[start])
        for step in range(m):
            k = (start + step) % m
            nxt = int(pts[(k + 1) % m])
            cur.append(nxt)
            at_end = step == m - 1
            if at_end or is_junction[nxt] or int(par[(k + 1) % m]) != cur_par:
                seq = np.array(cur, dtype=np.int32)
                rev = seq[::-1]
                fwd_key = seq.tobytes()
                rev_key = rev.tobytes()
                existing = arc_lookup.get(fwd_key)
                if existing is not None:
                    refs.append(existing)
                else:
                    existing = arc_lookup.get(rev_key)
                    if existing is not None:
                        refs.append(~existing)
                    else:
                        idx = len(arc_pts)
                        arc_pts.append(seq)
                        arc_left.append(prov)
                        arc_right.append(cur_par)
                        arc_lookup[fwd_key] = idx
                        refs.append(idx)
                if not at_end:
                    cur = [nxt]
                    cur_par = int(par[(k + 1) % m])
        ring_arcs.append(refs)

        if (r + 1) % 5000 == 0:
            print(f"  ... {r+1}/{n_rings} rings, {len(arc_pts):,} arcs", flush=True)

    # ---- 4. pack ---------------------------------------------------------
    arc_off = np.zeros(len(arc_pts) + 1, dtype=np.int64)
    arc_off[1:] = np.cumsum([len(a) for a in arc_pts])
    arc_flat = np.concatenate(arc_pts) if arc_pts else np.zeros(0, dtype=np.int32)

    ring_arc_off = np.zeros(n_rings + 1, dtype=np.int64)
    ring_arc_off[1:] = np.cumsum([len(a) for a in ring_arcs])
    ring_arc_flat = np.array([v for refs in ring_arcs for v in refs], dtype=np.int32)

    np.savez_compressed(
        OUT_NPZ,
        arc_flat=arc_flat,
        arc_off=arc_off,
        arc_left=np.array(arc_left, dtype=np.int32),
        arc_right=np.array(arc_right, dtype=np.int32),
        ring_arc_flat=ring_arc_flat,
        ring_arc_off=ring_arc_off,
    )

    n_arcs = len(arc_pts)
    shared = int((np.array(arc_right) >= 0).sum())
    report = {
        "arcs": n_arcs,
        "arcs_shared": shared,
        "arcs_open": n_arcs - shared,
        "arc_vertices": int(arc_off[-1]),
        "source_vertices": int(len(ring_pts)),
        "avg_arc_vertices": round(float(arc_off[-1]) / max(n_arcs, 1), 1),
    }
    OUT_REPORT.write_text(json.dumps(report, indent=1), encoding="utf-8")

    print()
    print("=" * 64)
    print(f"arcs               : {n_arcs:,}")
    print(f"  shared (A|B)     : {shared:,}")
    print(f"  open (coast/sea) : {n_arcs - shared:,}")
    print(f"arc vertices       : {int(arc_off[-1]):,}  "
          f"(source rings had {len(ring_pts):,})")
    print(f"dedup saving       : "
          f"{100 * (1 - arc_off[-1] / max(len(ring_pts), 1)):.1f}%")
    print(f"avg vertices/arc   : {report['avg_arc_vertices']}")
    print(f"wrote {OUT_NPZ} ({OUT_NPZ.stat().st_size / 1e6:.1f} MB)")
    print("=" * 64)


if __name__ == "__main__":
    main()
