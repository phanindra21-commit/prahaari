from shapely.geometry import box

from app.config_loader import SUITABILITY_AHP
from app.engine.suitability import compute_hazard_safety, compute_site_suitability

_GOOD_ATTRIBUTES = {
    "slopeDegrees": 2.0,
    "distanceToAllWeatherRoadM": 50.0,
    "availableWaterSupplyLpd": 60000.0,
    "existingInfrastructureIndex": 1.0,
}

_POOR_ATTRIBUTES = {
    "slopeDegrees": 20.0,
    "distanceToAllWeatherRoadM": 2000.0,
    "availableWaterSupplyLpd": 5000.0,
    "existingInfrastructureIndex": 0.0,
}


def test_sub_scores_sum_to_overall_score_via_configured_weights():
    result = compute_site_suitability(
        _GOOD_ATTRIBUTES,
        area_sqm=80_000.0,
        land_ownership="GOVT",
        hazard_safety_score=1.0,
        distance_from_habitation_km=0.0,
        livelihood_distance_km=0.0,
    )
    weights = SUITABILITY_AHP["weights"]
    expected = sum(weights[k] * v for k, v in result.sub_scores.items())
    assert result.overall_score == expected
    assert set(result.sub_scores.keys()) == set(weights.keys())


def test_best_case_inputs_score_near_the_maximum():
    result = compute_site_suitability(
        _GOOD_ATTRIBUTES,
        area_sqm=80_000.0,
        land_ownership="GOVT",
        hazard_safety_score=1.0,
        distance_from_habitation_km=0.0,
        livelihood_distance_km=0.0,
    )
    assert result.overall_score > 0.95


def test_worst_case_inputs_score_near_the_minimum():
    result = compute_site_suitability(
        _POOR_ATTRIBUTES,
        area_sqm=20_000.0,
        land_ownership="FOREST",
        hazard_safety_score=0.0,
        distance_from_habitation_km=30.0,
        livelihood_distance_km=10.0,
    )
    assert result.overall_score < 0.05


def test_land_ownership_ease_ranks_govt_above_private():
    govt = compute_site_suitability(
        _GOOD_ATTRIBUTES, 50_000.0, "GOVT", 0.8, 5.0, 2.0
    )
    private = compute_site_suitability(
        _GOOD_ATTRIBUTES, 50_000.0, "PRIVATE", 0.8, 5.0, 2.0
    )
    assert govt.sub_scores["landOwnershipAcquisitionEase"] > private.sub_scores["landOwnershipAcquisitionEase"]
    assert govt.overall_score > private.overall_score


def test_overall_score_is_clamped_to_0_1():
    result = compute_site_suitability(
        _GOOD_ATTRIBUTES, 200_000.0, "GOVT", 1.0, -5.0, -5.0
    )
    assert 0.0 <= result.overall_score <= 1.0


def test_hazard_safety_is_1_when_no_red_orange_zones_exist():
    site = box(76.0, 11.0, 76.01, 11.01)
    assert compute_hazard_safety(site, []) == 1.0


def test_hazard_safety_is_0_when_site_touches_a_red_orange_zone():
    site = box(76.0, 11.0, 76.01, 11.01)
    zone = box(76.0, 11.0, 76.02, 11.02)
    assert compute_hazard_safety(site, [zone]) == 0.0


def test_hazard_safety_decreases_as_site_gets_closer_to_a_zone():
    zone = box(80.0, 15.0, 80.01, 15.01)
    far_site = box(76.0, 11.0, 76.01, 11.01)
    near_site = box(79.97, 14.97, 79.98, 14.98)
    far_score = compute_hazard_safety(far_site, [zone])
    near_score = compute_hazard_safety(near_site, [zone])
    assert near_score < far_score
    assert far_score == 1.0
    assert 0.0 < near_score < 1.0
