import h3
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

RED_ZONE_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[[75.9, 11.5], [76.1, 11.5], [76.1, 11.7], [75.9, 11.7], [75.9, 11.5]]],
}

_SAFE_RAW_ATTRIBUTES = {
    "slopeDegrees": 5.0,
    "inCrzI": False,
    "inProtectedForest": False,
    "inFloodplain100yr": False,
    "distanceToActiveFaultM": 5000.0,
    "distanceToWaterBodyM": 300.0,
    "inMiningLease": False,
    "distanceToAllWeatherRoadM": 200.0,
    "availableWaterSupplyLpd": 45000.0,
    "nearbySchoolSpareCapacitySeats": 120.0,
    # Deliberately generous vs a real seed value so the binding constraint
    # in test_safe_site_far_from_hazard_zone_is_scored isn't pinned to
    # HEALTH, and so the matching tests have enough headroom for 20
    # households (real IPHS PHC norms give tiny per-site health capacity).
    "nearbyHealthFacilitySpareCapacityPopulation": 200_000.0,
    "existingInfrastructureIndex": 0.5,
}


def _safe_site(site_id: str, lon: float, lat: float) -> dict:
    return {
        "siteId": site_id,
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat + 0.01], [lon, lat]]
            ],
        },
        "lon": lon,
        "lat": lat,
        "areaSqm": 50_000.0,
        "landOwnership": "GOVT",
        "rawAttributes": _SAFE_RAW_ATTRIBUTES,
    }


def _habitation(habitation_id: str, lon: float, lat: float, bucket: str = "Immediate") -> dict:
    return {
        "habitationId": habitation_id,
        "lon": lon,
        "lat": lat,
        "distanceToLivelihoodAssetKm": 1.0,
        "households": 20,
        "priorityBucket": bucket,
        "relocationPriorityIndex": 0.8,
    }


def test_site_inside_red_zone_is_excluded_with_reason():
    body = {
        "state": "Kerala",
        "terrainTier": "HILLY_TRIBAL",
        "redOrangeZoneGeometries": [RED_ZONE_GEOJSON],
        "sites": [_safe_site("failing", 76.0, 11.6)],
        "habitations": [],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    site = response.json()["sites"][0]
    assert site["exclusions"]["excluded"] is True
    assert "insideRedOrOrangeZone" in site["exclusions"]["failed"]
    assert site["overallSuitabilityScore"] is None
    assert site["carryingCapacity"] is None


def test_safe_site_far_from_hazard_zone_is_scored():
    body = {
        "state": "Kerala",
        "terrainTier": "HILLY_TRIBAL",
        "redOrangeZoneGeometries": [RED_ZONE_GEOJSON],
        "sites": [_safe_site("safe", 78.0, 13.0)],
        "habitations": [],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    site = response.json()["sites"][0]
    assert site["exclusions"]["excluded"] is False
    assert site["overallSuitabilityScore"] is not None
    assert 0.0 <= site["overallSuitabilityScore"] <= 1.0
    assert site["carryingCapacity"]["bindingConstraint"] in {
        "LAND", "WATER", "EDUCATION", "HEALTH", "ACCESS",
    }


def test_matching_allocates_the_immediate_habitation_to_the_surviving_site():
    body = {
        "state": "Odisha",
        "terrainTier": "PLAINS",
        "redOrangeZoneGeometries": [RED_ZONE_GEOJSON],
        "sites": [_safe_site("safe", 78.0, 13.0)],
        "habitations": [_habitation("hab1", 78.001, 13.001, "Immediate")],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    body_json = response.json()
    [match] = body_json["matches"]
    assert match["habitationId"] == "hab1"
    assert match["allocatedSiteId"] == "safe"
    assert match["allocatedHouseholds"] == 20
    assert match["rankedSites"][0]["siteId"] == "safe"


def test_mediumterm_habitations_are_excluded_from_matching():
    body = {
        "state": "Odisha",
        "terrainTier": "PLAINS",
        "redOrangeZoneGeometries": [],
        "sites": [_safe_site("safe", 78.0, 13.0)],
        "habitations": [_habitation("hab1", 78.001, 13.001, "MediumTerm")],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    assert response.json()["matches"] == []


def test_matching_includes_a_route_when_grid_cells_are_supplied():
    hab_lon, hab_lat = 78.001, 13.001
    site_lon, site_lat = 78.0, 13.0
    center = h3.latlng_to_cell(hab_lat, hab_lon, 8)
    grid_cells = [
        {"h3Index": cell, "lon": lon, "lat": lat, "zoneClass": "Green", "score": 0.1}
        for cell, (lat, lon) in ((c, h3.cell_to_latlng(c)) for c in h3.grid_disk(center, 4))
    ]

    body = {
        "state": "Odisha",
        "terrainTier": "PLAINS",
        "redOrangeZoneGeometries": [],
        "sites": [_safe_site("safe", site_lon, site_lat)],
        "habitations": [_habitation("hab1", hab_lon, hab_lat, "Immediate")],
        "gridCells": grid_cells,
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    [match] = response.json()["matches"]
    [ranked] = match["rankedSites"]
    assert ranked["routeSafetyScore"] == 1.0
    assert ranked["route"] is not None
    assert ranked["route"]["routeLengthKm"] > 0
    assert ranked["route"]["directLengthKm"] > 0
    assert all(e["zoneClass"] == "Green" for e in ranked["route"]["routeExposure"])


def test_matching_without_grid_cells_field_omits_route_as_before():
    body = {
        "state": "Odisha",
        "terrainTier": "PLAINS",
        "redOrangeZoneGeometries": [],
        "sites": [_safe_site("safe", 78.0, 13.0)],
        "habitations": [_habitation("hab1", 78.001, 13.001, "Immediate")],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 200
    [match] = response.json()["matches"]
    [ranked] = match["rankedSites"]
    assert ranked["route"] is None
    assert ranked["routeSafetyScore"] is None


def test_invalid_geometry_returns_422():
    body = {
        "state": "Kerala",
        "terrainTier": "HILLY_TRIBAL",
        "redOrangeZoneGeometries": [],
        "sites": [{**_safe_site("bad", 76.0, 11.6), "geometry": {"type": "NotAGeometry", "coordinates": []}}],
        "habitations": [],
    }
    response = client.post("/sites/run", json=body)
    assert response.status_code == 422
