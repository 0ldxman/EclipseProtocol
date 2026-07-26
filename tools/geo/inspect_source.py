"""Stage 0 of the geo pipeline: measure the source province layer.

Streams ECL_Provinces.geojson with ijson (the file is ~325 MB, so nothing is
ever fully materialised) and reports what we actually have to work with:
feature/vertex counts, the heaviest provinces, geometry validity, duplicate
fids and the shapeGroup distribution.

Everything downstream (how aggressively to simplify, whether arc topology is
viable, how big the tiles will be) is a judgement call on these numbers, so
this runs first and reports before anything is transformed.
"""

import sys
from collections import Counter
from pathlib import Path

import ijson

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else
           "/config/workspace/aether/old/map/backend/data/geo/ECL_Provinces.geojson")


def ring_vertex_counts(geom):
    """Vertex count per ring, for a Polygon or MultiPolygon coordinate tree."""
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        polys = [coords]
    elif gtype == "MultiPolygon":
        polys = coords
    else:
        return []
    return [len(ring) for poly in polys for ring in poly]


def main() -> None:
    print(f"source: {SRC}  ({SRC.stat().st_size / 1e6:.0f} MB)", flush=True)

    features = 0
    total_vertices = 0
    total_rings = 0
    total_polys = 0
    geom_types = Counter()
    groups = Counter()
    fids = Counter()
    missing_geom = 0
    # (vertices, fid, name, group, polygon count)
    heaviest: list[tuple[int, object, str, str, int]] = []
    vertex_buckets = Counter()

    with SRC.open("rb") as fh:
        for feat in ijson.items(fh, "features.item", use_float=True):
            features += 1
            props = feat.get("properties") or {}
            fid = props.get("fid")
            name = props.get("shapeName") or ""
            group = props.get("shapeGroup") or ""
            fids[fid] += 1
            groups[group] += 1

            geom = feat.get("geometry")
            if not geom:
                missing_geom += 1
                continue
            geom_types[geom.get("type")] += 1

            rings = ring_vertex_counts(geom)
            verts = sum(rings)
            npolys = (len(geom.get("coordinates") or [])
                      if geom.get("type") == "MultiPolygon" else 1)

            total_vertices += verts
            total_rings += len(rings)
            total_polys += npolys

            heaviest.append((verts, fid, name, group, npolys))
            # keep the list from growing to 3409 entries needlessly is not worth
            # it, but keep it trimmed anyway so sorting at the end stays cheap
            if len(heaviest) > 400:
                heaviest.sort(reverse=True)
                del heaviest[200:]

            if verts < 100:
                vertex_buckets["<100"] += 1
            elif verts < 1_000:
                vertex_buckets["100-1k"] += 1
            elif verts < 10_000:
                vertex_buckets["1k-10k"] += 1
            elif verts < 100_000:
                vertex_buckets["10k-100k"] += 1
            else:
                vertex_buckets[">100k"] += 1

            if features % 500 == 0:
                print(f"  ... {features} features, {total_vertices/1e6:.1f}M vertices",
                      flush=True)

    heaviest.sort(reverse=True)

    print()
    print("=" * 64)
    print(f"features          : {features}")
    print(f"missing geometry  : {missing_geom}")
    print(f"geometry types    : {dict(geom_types)}")
    print(f"polygons (parts)  : {total_polys}")
    print(f"rings             : {total_rings}")
    print(f"vertices          : {total_vertices:,}")
    print(f"avg vertices/prov : {total_vertices // max(features, 1):,}")
    print()
    print("vertex distribution:")
    for bucket in ("<100", "100-1k", "1k-10k", "10k-100k", ">100k"):
        if vertex_buckets[bucket]:
            print(f"  {bucket:>9} : {vertex_buckets[bucket]}")
    print()
    dupes = {f: n for f, n in fids.items() if n > 1}
    print(f"duplicate fids    : {len(dupes)}" + (f"  {list(dupes)[:10]}" if dupes else ""))
    print(f"null fids         : {fids.get(None, 0)}")
    print(f"shapeGroups       : {len(groups)}")
    print(f"empty shapeGroup  : {groups.get('', 0)}")
    print()
    print("heaviest 15 provinces (vertices, parts):")
    for verts, fid, name, group, npolys in heaviest[:15]:
        share = 100 * verts / max(total_vertices, 1)
        print(f"  {verts:>10,}v  {npolys:>6} parts  {share:5.1f}%  "
              f"fid={fid} {group} {name}")
    top20 = sum(v for v, *_ in heaviest[:20])
    print()
    print(f"top 20 provinces hold {100*top20/max(total_vertices,1):.1f}% of all vertices")
    print("=" * 64)


if __name__ == "__main__":
    main()
