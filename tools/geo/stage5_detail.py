"""Stage 5: pack the fine levels of detail as *server-side* arc stores.

Stage 4 writes bundles the browser downloads whole. That only works while a
level is small: lod3 is 1.9 MB gzipped and lod2 is 4.2, but lod1 is 15.2 MB and
lod0 is over thirty. Nobody downloads the whole world at 55 m precision, and
nobody needs to - at the zoom where 55 m is visible you are looking at a few
hundredths of a degree.

So the fine levels are not bundles at all. They are stores the server slices:
the client says "give me arcs 4102, 4103 and 9871 at lod1" and gets back a few
kilobytes. This works because every LOD shares one arc numbering - stage 3
simplifies arcs in place, so arc 4102 is the same stretch of boundary at every
level, and refining it means swapping its coordinates while the ring that
references it, its two neighbouring provinces and its feature id all stay put.

Only `arc_off` and `arc_xy` are written here. Everything else about the
topology - which arcs make a ring, which provinces flank an arc - is level
independent and already in the client's base bundle.

The output lives outside the statically served geo directory on purpose: these
files are meant to be read a slice at a time, not fetched.
"""

import json
from pathlib import Path

import numpy as np

ROOT = Path("/config/workspace/aether")
IN_LOD = ROOT / "data/arcs_lod.npz"
OUT_DIR = ROOT / "data/geo-detail"

QUANT = 1e-6
DETAIL_LODS = ["lod1", "lod0"]


def main() -> None:
    lods = np.load(IN_LOD)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for lod in DETAIL_LODS:
        xy = lods[f"{lod}_xy"]
        off = lods[f"{lod}_off"].astype(np.int32)

        q = np.round(xy.astype(np.float64) / QUANT).astype(np.int64)
        delta = q.copy()
        # Delta-encode inside each arc, exactly as stage 4 does, so the client
        # decodes a sliced arc with the same code that decodes a bundled one.
        starts = off[:-1].astype(np.int64)
        mask = np.ones(len(q), dtype=bool)
        mask[starts] = False
        delta[mask] = q[mask] - q[np.flatnonzero(mask) - 1]
        if np.abs(delta).max() > 2**31 - 1:
            raise SystemExit(f"{lod}: delta overflows int32")

        bin_path = OUT_DIR / f"detail-{lod}.bin"
        bin_path.write_bytes(delta.astype(np.int32).tobytes())

        # The offset table is the whole index: 33 660 int32 the server keeps in
        # memory, turning "arc 4102" into a byte range to read.
        (OUT_DIR / f"detail-{lod}.json").write_text(
            json.dumps(
                {
                    "lod": lod,
                    "quantization": QUANT,
                    "coordEncoding": "delta-int32-per-arc",
                    "arcs": int(len(off) - 1),
                    "vertices": int(len(xy)),
                    "binary": bin_path.name,
                    "arcOff": [int(v) for v in off],
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        print(f"  {lod}: {len(xy):,} vertices, {bin_path.stat().st_size / 1e6:.1f} MB",
              flush=True)

    print()
    print("=" * 64)
    for f in sorted(OUT_DIR.iterdir()):
        print(f"  {f.name:<24} {f.stat().st_size / 1e6:8.2f} MB")
    print("=" * 64)


if __name__ == "__main__":
    main()
