import h3
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _synthetic_wayanad_cells(n: int = 300) -> list[dict]:
    """A small, self-contained landslide cell set (not read from
    data/processed/ — the route must work from request data alone). Uses
    real H3 indices (not arbitrary labels) since the route dissolves zone
    geometry by regenerating each cell's boundary from its h3Index."""
    rng = np.random.default_rng(0)
    cells = []
    for _ in range(n):
        lon = 76.0 + rng.uniform(0, 0.3)
        lat = 11.6 + rng.uniform(0, 0.3)
        cells.append(
            {
                "h3Index": h3.latlng_to_cell(lat, lon, 8),
                "district": "wayanad",
                "lon": lon,
                "lat": lat,
                "factors": {
                    "slope": float(rng.uniform(1, 45)),
                    "lithology": float(rng.uniform(0, 1)),
                    "landCover": float(rng.uniform(0, 1)),
                    "antecedentRainfallIndex": float(rng.uniform(0, 1)),
                    "soilDepth": float(rng.uniform(0.3, 6)),
                    "distanceToDrainage": float(rng.uniform(0, 2.5)),
                    "distanceToRoadCut": float(rng.uniform(0, 1.2)),
                    "historicalIncidentDensity": float(rng.uniform(0, 1)),
                    "curvature": float(rng.uniform(0, 1)),
                    "aspect": float(rng.uniform(0, 1)),
                },
            }
        )
    return cells


def test_run_zoning_returns_a_score_and_zone_class_for_every_cell():
    cells = _synthetic_wayanad_cells()
    response = client.post("/zoning/run", json={"hazardType": "landslide", "cells": cells})

    assert response.status_code == 200
    body = response.json()
    assert len(body["cellScores"]) == len(cells)
    for score in body["cellScores"]:
        assert 0.0 <= score["overlayScore"] <= 1.0
        assert 0.0 <= score["mlScore"] <= 1.0
        assert 0.0 <= score["blendedScore"] <= 1.0
        assert score["zoneClass"] in ("Red", "Orange", "Yellow", "Green")
        assert 1 <= len(score["topFactors"]) <= 5
        for factor in score["topFactors"]:
            assert factor["direction"] in ("INCREASES_RISK", "DECREASES_RISK")
    assert body["labelSource"] == "SYNTHETIC_DEMO"
    assert set(body["featureList"]) == {
        "slope", "lithology", "landCover", "antecedentRainfallIndex", "soilDepth",
        "distanceToDrainage", "distanceToRoadCut", "historicalIncidentDensity",
        "curvature", "aspect",
    }


def test_run_zoning_returns_dissolved_zone_polygons_matching_cell_counts():
    cells = _synthetic_wayanad_cells()
    response = client.post("/zoning/run", json={"hazardType": "landslide", "cells": cells})
    body = response.json()

    cell_count_by_class = {}
    for score in body["cellScores"]:
        cell_count_by_class[score["zoneClass"]] = cell_count_by_class.get(score["zoneClass"], 0) + 1

    assert len(body["zones"]) == len(cell_count_by_class)
    for zone in body["zones"]:
        assert zone["cellCount"] == cell_count_by_class[zone["zoneClass"]]
        assert zone["geometry"]["type"] in ("Polygon", "MultiPolygon")
        assert zone["simplifiedGeometry"]["type"] in ("Polygon", "MultiPolygon")


def test_run_zoning_rejects_a_factor_missing_from_the_request():
    cells = _synthetic_wayanad_cells(n=5)
    del cells[0]["factors"]["slope"]
    response = client.post("/zoning/run", json={"hazardType": "landslide", "cells": cells})
    assert response.status_code == 422


def test_run_zoning_rejects_an_unknown_hazard_type():
    cells = _synthetic_wayanad_cells(n=5)
    response = client.post("/zoning/run", json={"hazardType": "earthquake", "cells": cells})
    assert response.status_code == 422


def test_run_zoning_rejects_an_empty_cell_list():
    response = client.post("/zoning/run", json={"hazardType": "landslide", "cells": []})
    assert response.status_code == 422
