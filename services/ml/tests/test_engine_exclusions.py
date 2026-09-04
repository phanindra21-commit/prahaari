from shapely.geometry import box

from app.engine.exclusions import evaluate_exclusions

_SAFE_ATTRIBUTES = {
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

_SITE_GEOM = box(76.0, 11.0, 76.01, 11.01)
_FAR_ZONE = box(80.0, 15.0, 80.01, 15.01)
_OVERLAPPING_ZONE = box(76.0, 11.0, 76.02, 11.02)


def test_site_with_all_safe_attributes_passes_every_criterion():
    result = evaluate_exclusions(_SITE_GEOM, _SAFE_ATTRIBUTES, [_FAR_ZONE])
    assert result.excluded is False
    assert result.failed == []
    assert len(result.passed) == 8


def test_site_intersecting_red_orange_zone_fails_that_criterion():
    result = evaluate_exclusions(_SITE_GEOM, _SAFE_ATTRIBUTES, [_OVERLAPPING_ZONE])
    assert result.excluded is True
    assert "insideRedOrOrangeZone" in result.failed


def test_site_in_crz_i_fails_that_criterion():
    attrs = {**_SAFE_ATTRIBUTES, "inCrzI": True}
    result = evaluate_exclusions(_SITE_GEOM, attrs, [_FAR_ZONE])
    assert "insideCrzI" in result.failed


def test_site_on_excessive_slope_fails_that_criterion():
    attrs = {**_SAFE_ATTRIBUTES, "slopeDegrees": 27.0}
    result = evaluate_exclusions(_SITE_GEOM, attrs, [_FAR_ZONE])
    assert "excessiveSlope" in result.failed


def test_site_within_water_body_buffer_fails_that_criterion():
    attrs = {**_SAFE_ATTRIBUTES, "distanceToWaterBodyM": 20.0}
    result = evaluate_exclusions(_SITE_GEOM, attrs, [_FAR_ZONE])
    assert "waterBodyBuffer" in result.failed


def test_slope_exactly_at_the_limit_passes():
    attrs = {**_SAFE_ATTRIBUTES, "slopeDegrees": 20.0}
    result = evaluate_exclusions(_SITE_GEOM, attrs, [_FAR_ZONE])
    assert "excessiveSlope" not in result.failed


def test_every_criterion_is_checked_not_short_circuited():
    attrs = {
        **_SAFE_ATTRIBUTES,
        "inCrzI": True,
        "inProtectedForest": True,
        "slopeDegrees": 25.0,
    }
    result = evaluate_exclusions(_SITE_GEOM, attrs, [_OVERLAPPING_ZONE])
    assert set(result.failed) == {
        "insideRedOrOrangeZone",
        "insideCrzI",
        "protectedOrReservedForest",
        "excessiveSlope",
    }
