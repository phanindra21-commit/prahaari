"""Commit 3 status check: classifies + dissolves zone polygons for every
hazard and prints the resulting Red/Orange/Yellow/Green split across the
80 seeded habitations, after multi-hazard aggregation (METHODOLOGY §1.3).

Writes data/processed/<hazard>-zones.geojson (one Feature per district +
zoneClass; `geometry` is the simplified boundary for map rendering,
`properties.fullGeometry` the unsimplified one for audit/analysis) for
apps/api's zoning job (Step 4 commit 4) to ingest.

Every score here comes from models trained on SYNTHETIC_DEMO labels
(app/engine/labels.py) — there is no real historical hazard inventory
wired in yet.

Usage (from services/ml, with the venv active):
    python scripts/run_zoning_pipeline.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shapely.geometry import Point  # noqa: E402

from app.engine.pipeline import score_hazard  # noqa: E402
from app.engine.zones import (  # noqa: E402
    aggregate_multi_hazard,
    classify_zone,
    dissolve_zone_class,
    geometry_to_geojson,
)

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
PROCESSED_DIR = DATA_DIR / "processed"
SEED_DIR = DATA_DIR / "seed"

HAZARDS = ["landslide", "flood", "coastalErosion", "cloudburst"]
ZONE_CLASSES_SEVERITY_ORDER = ["Red", "Orange", "Yellow", "Green"]

HABITATION_FILES = {
    "wayanad": "wayanad-habitations.geojson",
    "ganjam": "ganjam-habitations.geojson",
}


def build_zones_for_hazard(hazard: str):
    """Returns (geojson_feature_collection, cell_counts, zone_geoms) where
    zone_geoms[district][zoneClass] = full-resolution shapely geometry, for
    the habitation spatial join below."""
    result = score_hazard(hazard)

    cells_by_group: dict[tuple[str, str], list[str]] = defaultdict(list)
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    blended_sum_by_group: dict[tuple[str, str], float] = defaultdict(float)
    for h3_index, district, blended in zip(result.h3_indexes, result.districts, result.blended_scores):
        zone_class = classify_zone(float(blended), hazard)
        cells_by_group[(district, zone_class)].append(h3_index)
        counts[district][zone_class] += 1
        blended_sum_by_group[(district, zone_class)] += float(blended)

    model_version = f"{hazard}-overlay-ml-v1"
    features = []
    zone_geoms: dict[str, dict[str, object]] = defaultdict(dict)

    for (district, zone_class), h3_indexes in sorted(cells_by_group.items()):
        full, simplified = dissolve_zone_class(h3_indexes)
        zone_geoms[district][zone_class] = full
        # Mean blended score across the class's cells — the same "representative
        # hazardScore per zone class" apps/api's live zoningJob.ts persists onto
        # HazardZone.hazardScore, kept consistent here for run_priority_pipeline.py.
        mean_hazard_score = blended_sum_by_group[(district, zone_class)] / len(h3_indexes)
        features.append(
            {
                "type": "Feature",
                "geometry": geometry_to_geojson(simplified),
                "properties": {
                    "district": district,
                    "hazardType": hazard,
                    "zoneClass": zone_class,
                    "cellCount": len(h3_indexes),
                    "modelVersion": model_version,
                    "hazardScore": round(mean_hazard_score, 4),
                    "fullGeometry": geometry_to_geojson(full),
                },
            }
        )

    feature_collection = {"type": "FeatureCollection", "features": features}
    return feature_collection, counts, zone_geoms


def zone_class_for_point(zone_geoms_for_district: dict[str, object], lon: float, lat: float) -> str | None:
    point = Point(lon, lat)
    for zone_class in ZONE_CLASSES_SEVERITY_ORDER:
        geom = zone_geoms_for_district.get(zone_class)
        if geom is not None and geom.intersects(point):
            return zone_class
    return None


def main() -> None:
    zone_geoms_by_hazard: dict[str, dict[str, dict[str, object]]] = {}

    for hazard in HAZARDS:
        feature_collection, counts, zone_geoms = build_zones_for_hazard(hazard)
        zone_geoms_by_hazard[hazard] = zone_geoms

        out_path = PROCESSED_DIR / f"{hazard}-zones.geojson"
        out_path.write_text(json.dumps(feature_collection, indent=2), encoding="utf-8")

        print(f"\n[run_zoning_pipeline] {hazard}: wrote {len(feature_collection['features'])} zone polygons -> {out_path}")
        for district, class_counts in sorted(counts.items()):
            ordered = {c: class_counts.get(c, 0) for c in ZONE_CLASSES_SEVERITY_ORDER}
            print(f"[run_zoning_pipeline]   {district}: {ordered}")

    # --- habitation split (after multi-hazard aggregation) ---
    overall_counts: dict[str, int] = defaultdict(int)
    per_hazard_missing: dict[str, int] = defaultdict(int)
    total_habitations = 0

    for district, filename in HABITATION_FILES.items():
        districts_json = json.loads((SEED_DIR / "districts.json").read_text(encoding="utf-8"))
        district_meta = next(d for d in districts_json if d["name"].strip().lower() == district)
        primary_hazards = district_meta["primaryHazards"]

        habitations = json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))
        for feature in habitations["features"]:
            total_habitations += 1
            lon, lat = feature["geometry"]["coordinates"]
            zone_class_by_hazard: dict[str, str] = {}
            for hazard in primary_hazards:
                zone_geoms_for_district = zone_geoms_by_hazard[hazard].get(district, {})
                zc = zone_class_for_point(zone_geoms_for_district, lon, lat)
                if zc is None:
                    per_hazard_missing[hazard] += 1
                else:
                    zone_class_by_hazard[hazard] = zc

            overall = aggregate_multi_hazard(zone_class_by_hazard)
            overall_counts[overall] += 1

    print(f"\n[run_zoning_pipeline] Habitation zone-class split ({total_habitations} seeded habitations, after multi-hazard aggregation):")
    for zone_class in ZONE_CLASSES_SEVERITY_ORDER:
        count = overall_counts.get(zone_class, 0)
        pct = 100 * count / total_habitations if total_habitations else 0
        print(f"[run_zoning_pipeline]   {zone_class:8s} {count:3d}  ({pct:5.1f}%)")

    if per_hazard_missing:
        print(
            "[run_zoning_pipeline] NOTE: some habitations fall outside the generated H3 grid for a "
            "hazard (their point is outside the district's seed boundary polygon) and were excluded "
            "from that hazard's contribution to the aggregate — counted per hazard, not silently "
            "treated as Green:"
        )
        for hazard, count in sorted(per_hazard_missing.items()):
            print(f"[run_zoning_pipeline]   {hazard}: {count} habitation(s) with no grid coverage")

    red_or_orange = overall_counts.get("Red", 0) + overall_counts.get("Orange", 0)
    red_share = overall_counts.get("Red", 0) / total_habitations if total_habitations else 0
    if red_share > 0.5:
        print(
            f"[run_zoning_pipeline] WARNING: {overall_counts.get('Red', 0)}/{total_habitations} "
            f"({100 * red_share:.0f}%) of habitations land in Red — thresholds or factors likely need "
            "tuning before Step 5. Flagging rather than proceeding silently."
        )
    else:
        print(
            f"[run_zoning_pipeline] {red_or_orange}/{total_habitations} habitations land in Red or "
            "Orange (enter the vulnerability/RPI pipeline per METHODOLOGY §1.3); the rest are Yellow/Green."
        )


if __name__ == "__main__":
    main()
