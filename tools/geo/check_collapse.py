"""Diagnostic: how much land does each LOD lose?

Simplification is applied per arc, and an arc small enough relative to the
tolerance collapses to a straight two-point line. A ring made of such arcs stops
being a polygon and disappears from rendering entirely - which is what small
islands look like on the map: missing, sea-coloured holes.

This counts, per LOD, the rings that fall below a drawable polygon and the
provinces that lose *all* of their rings, and names the worst-hit countries.
"""

import json
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path("/config/workspace/aether")
LODS = ["lod0", "lod1", "lod2", "lod3"]


def main() -> None:
    arcs = np.load(ROOT / "data/arcs.npz")
    lods = np.load(ROOT / "data/arcs_lod.npz")
    parsed = np.load(ROOT / "data/parsed.npz")
    provinces = json.loads((ROOT / "data/provinces.json").read_text(encoding="utf-8"))

    ring_arc = arcs["ring_arc_flat"]
    ring_arc_off = arcs["ring_arc_off"]
    ring_prov = parsed["ring_prov"]
    ring_hole = parsed["ring_hole"]
    n_rings = len(ring_prov)

    print(f"rings: {n_rings}, provinces: {len(provinces)}")
    print()

    for lod in LODS:
        off = lods[f"{lod}_off"]
        arc_len = np.diff(off)

        # Vertices in a ring = sum of its arcs' lengths, minus the shared
        # junction vertex each subsequent arc repeats.
        dead_rings = 0
        alive_by_prov = Counter()
        outer_by_prov = Counter()
        for r in range(n_rings):
            refs = ring_arc[ring_arc_off[r]:ring_arc_off[r + 1]]
            total = 0
            for ref in refs:
                i = int(ref)
                total += int(arc_len[~i if i < 0 else i])
            total -= max(len(refs) - 1, 0)
            prov = int(ring_prov[r])
            if not ring_hole[r]:
                outer_by_prov[prov] += 1
                if total >= 4:
                    alive_by_prov[prov] += 1
            if total < 4:
                dead_rings += 1

        lost_all = [p for p in outer_by_prov if alive_by_prov[p] == 0]
        lost_parts = sum(outer_by_prov[p] - alive_by_prov[p] for p in outer_by_prov)

        print(f"{lod}:")
        print(f"  rings below a drawable polygon : {dead_rings:>6} / {n_rings}")
        print(f"  outer rings (land parts) lost  : {lost_parts:>6}")
        print(f"  provinces that vanish entirely : {len(lost_all):>6}")
        if lost_all:
            groups = Counter(provinces[p]["group"] for p in lost_all)
            worst = ", ".join(f"{g}:{n}" for g, n in groups.most_common(8))
            print(f"    worst groups: {worst}")
            sample = ", ".join(
                f'{provinces[p]["group"]} {provinces[p]["name"]}' for p in lost_all[:6]
            )
            print(f"    e.g. {sample}")
        print()


if __name__ == "__main__":
    main()
