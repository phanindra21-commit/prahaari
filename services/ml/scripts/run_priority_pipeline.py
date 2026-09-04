"""Commit 2 status check: assesses every seeded habitation against the
zone GeoJSON run_zoning_pipeline.py just wrote (data/processed/<hazard>-
zones.geojson) and prints the resulting Immediate/ShortTerm/MediumTerm
split, the five highest-RPI habitations, and an explicit Chooralmala/
Mundakkai sanity check.

Reuses app.engine.assessment.assess_habitations_batch directly — the same
function the live /assessment/run route calls — against real seed data,
no MongoDB or HTTP round trip needed for this offline diagnostic. Batched
ONE CALL PER DISTRICT: normalize(Risk) (METHODOLOGY §3, priority.py) is
relative to the other Red/Orange habitations in the same batch, and that
population is scoped per district-per-run — see priority.py's module
docstring for why.

Every score here is SYNTHETIC_DEMO: it depends on the SYNTHETIC_DEMO
hazard-zoning pipeline (Step 4/5) and, for habitations, hand-authored
demo attributes (data/seed/*-habitations.geojson) — none of it is real
survey or historical data.

Usage (from services/ml, with the venv active, after running
scripts/run_zoning_pipeline.py to refresh data/processed/*-zones.geojson):
    python scripts/run_priority_pipeline.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shapely.geometry import shape  # noqa: E402

from app.engine.assessment import HabitationInput, assess_habitations_batch  # noqa: E402

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
PROCESSED_DIR = DATA_DIR / "processed"
SEED_DIR = DATA_DIR / "seed"

HAZARDS = ["landslide", "flood", "coastalErosion", "cloudburst"]

DISTRICT_HABITATION_FILES = {
    "wayanad": "wayanad-habitations.geojson",
    "ganjam": "ganjam-habitations.geojson",
}


def load_zone_data() -> dict[str, dict[str, dict[str, dict[str, object]]]]:
    """hazard -> district -> zoneClass -> {"geometry": shapely, "hazardScore": float}"""
    zone_data: dict[str, dict[str, dict[str, dict[str, object]]]] = {h: {} for h in HAZARDS}
    for hazard in HAZARDS:
        path = PROCESSED_DIR / f"{hazard}-zones.geojson"
        if not path.exists():
            continue
        collection = json.loads(path.read_text(encoding="utf-8"))
        for feature in collection["features"]:
            props = feature["properties"]
            district = props["district"]
            zone_class = props["zoneClass"]
            zone_data[hazard].setdefault(district, {})[zone_class] = {
                "geometry": shape(props["fullGeometry"]),
                "hazardScore": props["hazardScore"],
            }
    return zone_data


def districts_json() -> list[dict]:
    return json.loads((SEED_DIR / "districts.json").read_text(encoding="utf-8"))


def main() -> None:
    zone_data = load_zone_data()
    districts = {d["name"].strip().lower(): d for d in districts_json()}

    all_results: list[tuple[str, str, object]] = []  # (district, habitationName, AssessmentResult)
    bucket_counts_by_district: dict[str, dict[str, int]] = {}

    for district_slug, habitation_file in DISTRICT_HABITATION_FILES.items():
        district_meta = districts[district_slug]
        primary_hazards = district_meta["primaryHazards"]

        habitations_geojson = json.loads((SEED_DIR / habitation_file).read_text(encoding="utf-8"))
        bucket_counts_by_district[district_slug] = {
            "Immediate": 0, "ShortTerm": 0, "MediumTerm": 0, "unbucketed": 0,
        }

        hazard_zone_geoms = {}
        hazard_zone_scores = {}
        for hazard in primary_hazards:
            zones_for_district = zone_data.get(hazard, {}).get(district_slug, {})
            if not zones_for_district:
                continue
            hazard_zone_geoms[hazard] = {c: v["geometry"] for c, v in zones_for_district.items()}
            hazard_zone_scores[hazard] = {c: v["hazardScore"] for c, v in zones_for_district.items()}

        batch_inputs = []
        name_by_id: dict[str, str] = {}
        for feature in habitations_geojson["features"]:
            props = feature["properties"]
            lon, lat = feature["geometry"]["coordinates"]
            habitation_id = props["lgdHabitationCode"]
            name_by_id[habitation_id] = props["name"]
            batch_inputs.append(
                HabitationInput(
                    habitation_id=habitation_id,
                    lon=lon,
                    lat=lat,
                    households=props["households"],
                    attributes={
                        "demographics": props["demographics"],
                        "structures": props["structures"],
                        "access": props["access"],
                        "livelihood": props["livelihood"],
                        "copingCapacity": props["copingCapacity"],
                    },
                )
            )

        district_results = assess_habitations_batch(batch_inputs, hazard_zone_geoms, hazard_zone_scores)

        for result in district_results:
            bucket_key = result.priority_bucket or "unbucketed"
            bucket_counts_by_district[district_slug][bucket_key] += 1
            all_results.append((district_slug, name_by_id[result.habitation_id], result))

    print("\n[run_priority_pipeline] Habitation counts by priority bucket, per district:")
    for district_slug, counts in bucket_counts_by_district.items():
        print(f"[run_priority_pipeline]   {district_slug}: {counts}")

    total = {"Immediate": 0, "ShortTerm": 0, "MediumTerm": 0, "unbucketed": 0}
    for counts in bucket_counts_by_district.values():
        for key, value in counts.items():
            total[key] += value
    print(f"[run_priority_pipeline]   TOTAL: {total}")

    bucketed = [r for _, _, r in all_results if r.priority_bucket is not None]
    ranked = sorted(bucketed, key=lambda r: r.relocation_priority_index, reverse=True)

    print("\n[run_priority_pipeline] Top 5 highest-RPI habitations:")
    for district_slug, name, result in [
        (d, n, r) for d, n, r in all_results if r in ranked[:5]
    ][:5]:
        top_factors = ", ".join(f"{c['label']} ({c['contribution']:.3f})" for c in result.explanation[:3])
        print(
            f"[run_priority_pipeline]   {name} ({district_slug}): RPI={result.relocation_priority_index:.3f} "
            f"bucket={result.priority_bucket} governingHazard={result.governing_hazard} "
            f"risk={result.composite_risk_score:.3f} VI={result.vulnerability_index:.3f}"
        )
        print(f"[run_priority_pipeline]     top factors: {top_factors}")

    print("\n[run_priority_pipeline] Chooralmala/Mundakkai sanity check (the single most important check here):")
    for district_slug, name, result in all_results:
        if name in ("Chooralmala", "Mundakkai"):
            status = "IMMEDIATE (expected)" if result.priority_bucket == "Immediate" else "NOT IMMEDIATE"
            rpi_str = f"{result.relocation_priority_index:.4f}" if result.relocation_priority_index is not None else "None"
            print(
                f"[run_priority_pipeline]   {name}: bucket={result.priority_bucket} "
                f"RPI={rpi_str} zoneClass={result.overall_zone_class} "
                f"risk={result.composite_risk_score:.3f} VI={result.vulnerability_index:.3f}  <- {status}"
            )
            if result.priority_bucket != "Immediate":
                print(
                    f"[run_priority_pipeline]   WARNING: {name} did not land in Immediate — "
                    "investigate before treating this pipeline as demo-ready."
                )

    print("\n[run_priority_pipeline] Distribution shape:")
    bucketed_total = total["Immediate"] + total["ShortTerm"] + total["MediumTerm"]
    if bucketed_total > 0:
        for bucket in ("Immediate", "ShortTerm", "MediumTerm"):
            share = total[bucket] / bucketed_total
            print(f"[run_priority_pipeline]   {bucket}: {total[bucket]}/{bucketed_total} ({share:.1%})")
            if share > 0.5:
                print(
                    f"[run_priority_pipeline]   WARNING: {bucket} is over 50% of bucketed habitations — "
                    "a realistic distribution is a minority Immediate, a larger ShortTerm, and a long "
                    "MediumTerm tail. Investigate rather than proceeding silently."
                )
    else:
        print("[run_priority_pipeline]   No habitations were bucketed at all.")


if __name__ == "__main__":
    main()
