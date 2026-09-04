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


def test_factor_reclassification_covers_every_hazard_weight_factor():
    for hazard, hazard_config in cfg.HAZARD_WEIGHTS["hazards"].items():
        reclass_hazard = cfg.FACTOR_RECLASSIFICATION["hazards"][hazard]
        assert sorted(reclass_hazard.keys()) == sorted(hazard_config["factors"].keys())


def test_factor_reclassification_directions_are_declared():
    for hazard_config in cfg.FACTOR_RECLASSIFICATION["hazards"].values():
        for factor in hazard_config.values():
            assert factor["direction"] in ("DIRECT", "INVERSE")
            assert [bp["rating"] for bp in factor["breakpoints"]] == [1, 2, 3, 4, 5]
            assert factor["breakpoints"][-1]["max"] is None


def test_blend_config_alpha_in_range_per_hazard():
    for hazard in ("landslide", "flood", "coastalErosion", "cloudburst"):
        assert 0.0 <= cfg.BLEND_CONFIG["hazards"][hazard]["alpha"] <= 1.0


def test_scenario_parameters_rainfall_affects_landslide_and_flood_only():
    hazards_affected = {rule["hazard"] for rule in cfg.SCENARIO_PARAMETERS["rainfall"]["affects"]}
    assert hazards_affected == {"landslide", "flood"}


def test_scenario_parameters_every_affects_rule_references_a_real_hazard_factor():
    for section in ("rainfall", "seaLevelRise"):
        for rule in cfg.SCENARIO_PARAMETERS[section]["affects"]:
            assert rule["factor"] in cfg.HAZARD_WEIGHTS["hazards"][rule["hazard"]]["factors"]
    for rule in cfg.SCENARIO_PARAMETERS["cyclone"]["affects"]:
        assert rule["factor"] in cfg.HAZARD_WEIGHTS["hazards"][rule["hazard"]]["factors"]


def test_scenario_parameters_cyclone_categories_1_through_5_defined():
    categories = cfg.SCENARIO_PARAMETERS["cyclone"]["categories"]
    assert set(categories.keys()) == {"1", "2", "3", "4", "5"}
    for category, deltas in categories.items():
        assert 0.0 <= deltas["waveEnergyDelta"] <= 1.0
        assert 0.0 <= deltas["rainfallIntensityDelta"] <= 1.0


def test_scenario_parameters_presets_cite_documented_real_values():
    preset_ids = {p["id"] for p in cfg.SCENARIO_PARAMETERS["presets"]}
    assert preset_ids == {"wayanad-2024", "phailin-2013", "rcp85-2050"}
    for preset in cfg.SCENARIO_PARAMETERS["presets"]:
        assert preset["description"], f"{preset['id']} must document its real-world source"
        assert preset["parameters"], f"{preset['id']} must set at least one scenario parameter"
