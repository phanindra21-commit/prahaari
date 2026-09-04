from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

RED_ZONE_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[[75.9, 11.5], [76.1, 11.5], [76.1, 11.7], [75.9, 11.7], [75.9, 11.5]]],
}
GREEN_ZONE_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[[76.2, 11.5], [76.4, 11.5], [76.4, 11.7], [76.2, 11.7], [76.2, 11.5]]],
}

HABITATION_ATTRS = {
    "demographics": {
        "shareUnder5": 0.3, "shareOver60": 0.3, "womenHeadedHouseholdShare": 0.3,
        "disabledPersonsShare": 0.2, "bplShare": 0.6, "scStShare": 0.5, "literacyRate": 0.5,
    },
    "structures": {
        "kutchaHousingShare": 0.5, "avgBuildingAgeYears": 40,
        "predominantFoundationType": "RUBBLE",
    },
    "access": {
        "distanceToAllWeatherRoadKm": 5, "distanceToPhcKm": 10,
        "mobileNetworkCoverage": 0.3, "evacuationRouteCount": 1,
    },
    "livelihood": {
        "primaryOccupation": "AGRICULTURE", "distanceToLivelihoodAssetKm": 2,
        "primaryLivelihoodDependenceShare": 0.7,
    },
    "copingCapacity": {
        "sdrfResponseTimeMinutes": 90, "shelterWithin2km": False,
        "communityTaskForcePresent": False, "earlyWarningCoverage": 0.3,
    },
}


def _request_body(lon: float, lat: float, zone_geojson: dict, hazard_score: float, zone_class: str) -> dict:
    return {
        "hazardZones": {
            "landslide": [{"zoneClass": zone_class, "geometry": zone_geojson, "hazardScore": hazard_score}],
        },
        "habitations": [
            {
                "habitationId": "h1",
                "lon": lon,
                "lat": lat,
                "households": 200,
                **HABITATION_ATTRS,
            }
        ],
    }


def test_run_assessment_red_zone_habitation_gets_a_bucket():
    body = _request_body(76.0, 11.6, RED_ZONE_GEOJSON, 0.85, "Red")
    response = client.post("/assessment/run", json=body)

    assert response.status_code == 200
    data = response.json()["assessments"][0]
    assert data["overallZoneClass"] == "Red"
    assert data["priorityBucket"] is not None
    assert data["relocationPriorityIndex"] is not None
    assert len(data["explanation"]) == 5
    for factor in data["explanation"]:
        assert factor["label"]


def test_run_assessment_green_zone_habitation_has_no_bucket():
    body = _request_body(76.3, 11.6, GREEN_ZONE_GEOJSON, 0.1, "Green")
    response = client.post("/assessment/run", json=body)

    assert response.status_code == 200
    data = response.json()["assessments"][0]
    assert data["overallZoneClass"] == "Green"
    assert data["priorityBucket"] is None
    assert data["relocationPriorityIndex"] is None
    assert data["explanation"] == []
    # Still "recorded as assessed."
    assert 0.0 <= data["vulnerabilityIndex"] <= 1.0


def test_run_assessment_rejects_an_empty_habitations_list():
    body = {
        "hazardZones": {"landslide": [{"zoneClass": "Red", "geometry": RED_ZONE_GEOJSON, "hazardScore": 0.8}]},
        "habitations": [],
    }
    response = client.post("/assessment/run", json=body)
    assert response.status_code == 422
