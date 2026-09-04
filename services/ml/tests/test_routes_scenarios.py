import h3
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

HABITATION_ATTRS = {
    "demographics": {
        "shareUnder5": 0.3, "shareOver60": 0.3, "womenHeadedHouseholdShare": 0.3,
        "disabledPersonsShare": 0.2, "bplShare": 0.6, "scStShare": 0.5, "literacyRate": 0.5,
    },
    "structures": {"kutchaHousingShare": 0.5, "avgBuildingAgeYears": 40, "predominantFoundationType": "RUBBLE"},
    "access": {"distanceToAllWeatherRoadKm": 5, "distanceToPhcKm": 10, "mobileNetworkCoverage": 0.3, "evacuationRouteCount": 1},
    "livelihood": {"primaryOccupation": "AGRICULTURE", "distanceToLivelihoodAssetKm": 2, "primaryLivelihoodDependenceShare": 0.7},
    "copingCapacity": {"sdrfResponseTimeMinutes": 90, "shelterWithin2km": False, "communityTaskForcePresent": False, "earlyWarningCoverage": 0.3},
}


def _landslide_cells(n: int = 200) -> list[dict]:
    rng = np.random.default_rng(0)
    cells = []
    for _ in range(n):
        lon = 76.0 + rng.uniform(0, 0.3)
        lat = 11.6 + rng.uniform(0, 0.3)
        cells.append({
            "h3Index": h3.latlng_to_cell(lat, lon, 8),
            "district": "wayanad",
            "lon": lon,
            "lat": lat,
            "factors": {
                "slope": float(rng.uniform(1, 45)),
                "lithology": float(rng.uniform(0, 1)),
                "landCover": float(rng.uniform(0, 1)),
                "antecedentRainfallIndex": float(rng.uniform(0, 0.5)),
                "soilDepth": float(rng.uniform(0.3, 6)),
                "distanceToDrainage": float(rng.uniform(0, 2.5)),
                "distanceToRoadCut": float(rng.uniform(0, 1.2)),
                "historicalIncidentDensity": float(rng.uniform(0, 1)),
                "curvature": float(rng.uniform(0, 1)),
                "aspect": float(rng.uniform(0, 1)),
            },
        })
    return cells


def _base_body(**parameter_overrides) -> dict:
    return {
        "hazardCells": {"landslide": _landslide_cells()},
        "habitations": [
            {"habitationId": "h1", "lon": 76.1, "lat": 11.7, "households": 150, **HABITATION_ATTRS},
        ],
        "parameters": parameter_overrides,
    }


def test_run_scenario_rainfall_returns_hazard_summary_and_zone_geometries():
    body = _base_body(rainfallMmPer24h=800)
    response = client.post("/scenarios/run", json=body)

    assert response.status_code == 200
    data = response.json()
    assert len(data["hazardSummaries"]) == 1
    summary = data["hazardSummaries"][0]
    assert summary["hazard"] == "landslide"
    assert summary["affected"] is True
    assert sum(summary["baselineZoneCounts"].values()) == 200
    assert sum(summary["scenarioZoneCounts"].values()) == 200
    assert data["runtimeSeconds"] > 0
    assert len(data["zoneGeometries"]) == 1
    zone_geom = data["zoneGeometries"][0]
    assert zone_geom["hazard"] == "landslide"
    assert set(zone_geom["baseline"].keys()) <= {"Red", "Orange", "Yellow", "Green"}


def test_run_scenario_rejects_a_request_with_no_parameters_set():
    body = _base_body()
    response = client.post("/scenarios/run", json=body)
    assert response.status_code == 422


def test_run_scenario_rejects_missing_factor_in_a_cell():
    body = _base_body(rainfallMmPer24h=500)
    del body["hazardCells"]["landslide"][0]["factors"]["slope"]
    response = client.post("/scenarios/run", json=body)
    assert response.status_code == 422


def test_run_scenario_rejects_cyclone_category_out_of_range():
    body = _base_body(cycloneCategory=6)
    response = client.post("/scenarios/run", json=body)
    assert response.status_code == 422


def test_run_scenario_sea_level_rise_with_only_landslide_cells_reports_unaffected_hazard():
    # coastalErosion isn't in scope here at all — sea level rise still
    # validates and runs, it just has nothing to affect.
    body = _base_body(seaLevelRiseM=0.3)
    response = client.post("/scenarios/run", json=body)
    assert response.status_code == 200
    summary = response.json()["hazardSummaries"][0]
    assert summary["affected"] is False
    assert summary["cellsChanged"] == 0
