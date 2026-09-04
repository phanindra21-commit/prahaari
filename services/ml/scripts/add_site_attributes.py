"""One-time transform: adds `rawAttributes` (the synthetic inputs the new
exclusions/suitability/capacity engine needs) to every seeded relocation
site, and removes the old hand-baked `suitabilitySubScores`/
`overallSuitabilityScore`/`carryingCapacity` placeholder values — those
are now genuinely COMPUTED by the live pipeline (services/ml/app/engine/
{exclusions,suitability,capacity}.py), not seeded data.

Every non-geometry hard-filter input (CRZ-I, protected forest, 100-year
floodplain, active fault distance, mining lease) has no real GIS layer
in this project — same SYNTHETIC_DEMO convention as derive_factors.py's
causative factors: honest synthetic values, deterministically assigned
per site (not randomly), chosen so the sites the seed data's own naming
already designates "(FAILS)" genuinely fail via the real rule engine
(verified separately against live HazardZone geometry for the one
criterion — insideRedOrOrangeZone — that IS computed from real data).

Usage (from services/ml, with the venv active):
    python scripts/add_site_attributes.py
"""

from __future__ import annotations

import json
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parents[3] / "data" / "seed"

# name -> raw attribute overrides. Every other site gets the DEFAULTS
# below untouched (a comfortably-passing, mid-range plot).
OVERRIDES: dict[str, dict] = {
    # --- Wayanad "(FAILS)" sites ---
    "Chooralmala Adjacent Plot (FAILS)": {
        # Genuinely intersects a real Red landslide/cloudburst zone (verified
        # against live HazardZone geometry) -- no synthetic override needed
        # for the zone check itself; other attributes stay plausible.
    },
    "Vellarimala Slope Plot (FAILS)": {
        # Also genuinely intersects a real Red zone; ALSO fails on slope.
        "slopeDegrees": 27.0,
    },
    "Chundale Forest Fringe Plot (FAILS)": {
        "inProtectedForest": True,
    },
    # --- Ganjam "(FAILS)" sites ---
    "Podampeta Beachfront Plot (FAILS)": {
        "inCrzI": True,
    },
    "Sunapur Coastal Plot (FAILS)": {
        "inCrzI": True,
    },
    "Rushikulya Mouth Plot (FAILS)": {
        "distanceToWaterBodyM": 20.0,
        "inFloodplain100yr": True,
    },
    # --- A couple of passing sites nudged to be genuinely weaker on
    # specific capacity dimensions, so the carrying-capacity binding
    # constraint varies across the demo set rather than always being
    # the same domain. ---
    "Aska Government Plot": {"nearbyHealthFacilitySpareCapacityPopulation": 400},
    "Dharakot Revenue Land": {"availableWaterSupplyLpd": 8000},
    "Kartikulam Plot A": {"nearbySchoolSpareCapacitySeats": 15},
    "Sorada Inland Plot": {"distanceToAllWeatherRoadM": 900},
}

DEFAULTS = {
    "slopeDegrees": 9.0,
    "inCrzI": False,
    "inProtectedForest": False,
    "inFloodplain100yr": False,
    "distanceToActiveFaultM": 5000.0,
    "distanceToWaterBodyM": 300.0,
    "inMiningLease": False,
    "distanceToAllWeatherRoadM": 250.0,
    "availableWaterSupplyLpd": 45000.0,
    "nearbySchoolSpareCapacitySeats": 120.0,
    "nearbyHealthFacilitySpareCapacityPopulation": 1800.0,
    "existingInfrastructureIndex": 0.45,
}


def process(filename: str) -> None:
    path = SEED_DIR / filename
    data = json.loads(path.read_text(encoding="utf-8"))
    for feature in data["features"]:
        props = feature["properties"]
        name = props["name"]
        attrs = {**DEFAULTS, **OVERRIDES.get(name, {})}
        props["rawAttributes"] = attrs
        # These are now computed live by the pipeline's site-scoring stage,
        # not seeded -- remove the old hand-baked placeholders.
        props.pop("suitabilitySubScores", None)
        props.pop("overallSuitabilityScore", None)
        props.pop("carryingCapacity", None)
        # exclusionsPassed/exclusionsFailed are also now computed live.
        props.pop("exclusionsPassed", None)
        props.pop("exclusionsFailed", None)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"[add_site_attributes] updated {len(data['features'])} sites -> {path}")


def main() -> None:
    process("wayanad-relocation-sites.geojson")
    process("ganjam-relocation-sites.geojson")


if __name__ == "__main__":
    main()
