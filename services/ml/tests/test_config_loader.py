"""Verifies the ML service can load the shared weight-config JSON files
from packages/shared/src/config/ and that the weights are internally
consistent (sum to 1.0, AHP consistency ratio below threshold, etc).
"""

from app import config_loader as cfg


def test_hazard_weights_sum_to_one():
    for hazard, hazard_config in cfg.HAZARD_WEIGHTS["hazards"].items():
        total = sum(hazard_config["factors"].values())
        assert abs(total - 1.0) < 1e-6, f"{hazard} factors sum to {total}, not 1.0"


def test_vulnerability_dimension_weights_sum_to_one():
    dimensions = cfg.VULNERABILITY_WEIGHTS["dimensions"]
    total = sum(dimension["weight"] for dimension in dimensions.values())
    assert abs(total - 1.0) < 1e-6


def test_vulnerability_indicator_weights_sum_to_one_per_dimension():
    for name, dimension in cfg.VULNERABILITY_WEIGHTS["dimensions"].items():
        total = sum(dimension["indicators"].values())
        assert abs(total - 1.0) < 1e-6, f"{name} indicators sum to {total}, not 1.0"


def test_coping_capacity_indicators_sum_to_one():
    total = sum(cfg.VULNERABILITY_WEIGHTS["copingCapacity"]["indicators"].values())
    assert abs(total - 1.0) < 1e-6


def test_priority_weights_sum_to_one():
    total = sum(cfg.PRIORITY_WEIGHTS["weights"].values())
    assert abs(total - 1.0) < 1e-6


def test_suitability_ahp_weights_sum_to_one():
    total = sum(cfg.SUITABILITY_AHP["weights"].values())
    assert abs(total - 1.0) < 1e-6


def test_suitability_ahp_consistency_ratio_below_threshold():
    assert cfg.SUITABILITY_AHP["consistencyRatio"] < 0.10


def test_zone_thresholds_loaded_for_all_hazards():
    for hazard in ("landslide", "flood", "coastalErosion", "cloudburst"):
        assert hazard in cfg.ZONE_THRESHOLDS["perHazard"]


def test_capacity_norms_water_lpcd_matches_jal_jeevan_mission_norm():
    assert cfg.CAPACITY_NORMS["water"]["lpcd"] == 55


def test_exclusion_criteria_loaded():
    assert len(cfg.EXCLUSION_CRITERIA["criteria"]) > 0
