"""Loads and validates the shared weight-configuration JSON files.

These files live in packages/shared/src/config/ and are the single source
of truth for every weight used by both the Node API/web layer and this ML
service. See packages/shared/src/config/loader.ts for the TypeScript-side
loader — same validation rules, different language, same files on disk.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src" / "config"

WEIGHT_SUM_TOLERANCE = 1e-6


def _load_json(filename: str) -> dict[str, Any]:
    path = CONFIG_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"[ml/config] Missing shared config file: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _assert_sums_to_one(weights: dict[str, float], label: str) -> None:
    total = sum(weights.values())
    if abs(total - 1.0) > WEIGHT_SUM_TOLERANCE:
        raise ValueError(f"[ml/config] {label} must sum to 1.0, got {total}")


def load_hazard_weights() -> dict[str, Any]:
    config = _load_json("hazard-weights.json")
    for hazard, hazard_config in config["hazards"].items():
        _assert_sums_to_one(
            hazard_config["factors"], f"hazard-weights.json hazards.{hazard}.factors"
        )
    return config


def load_zone_thresholds() -> dict[str, Any]:
    return _load_json("zone-thresholds.json")


def load_vulnerability_weights() -> dict[str, Any]:
    config = _load_json("vulnerability-weights.json")
    dimensions = config["dimensions"]
    _assert_sums_to_one(
        {name: dim["weight"] for name, dim in dimensions.items()},
        "vulnerability-weights.json dimensions.*.weight",
    )
    for name, dimension in dimensions.items():
        _assert_sums_to_one(
            dimension["indicators"],
            f"vulnerability-weights.json dimensions.{name}.indicators",
        )
    _assert_sums_to_one(
        config["copingCapacity"]["indicators"],
        "vulnerability-weights.json copingCapacity.indicators",
    )
    return config


def load_indicator_normalization() -> dict[str, Any]:
    config = _load_json("indicator-normalization.json")

    required: set[str] = set()
    for dimension in VULNERABILITY_WEIGHTS["dimensions"].values():
        required.update(dimension["indicators"].keys())
    required.update(VULNERABILITY_WEIGHTS["copingCapacity"]["indicators"].keys())

    declared = set(config["indicators"].keys())
    missing = required - declared
    if missing:
        raise ValueError(
            f"[ml/config] indicator-normalization.json is missing entries for {sorted(missing)} "
            "(present in vulnerability-weights.json)"
        )
    extra = declared - required
    if extra:
        raise ValueError(
            f"[ml/config] indicator-normalization.json declares {sorted(extra)}, "
            "which are not vulnerability-weights.json indicators"
        )

    for name, entry in config["indicators"].items():
        if entry["method"] != "BOOLEAN" and entry["max"] <= entry["min"]:
            raise ValueError(
                f"[ml/config] indicator-normalization.json indicators.{name}: max "
                f"({entry['max']}) must be greater than min ({entry['min']})"
            )

    return config


def load_priority_weights() -> dict[str, Any]:
    config = _load_json("priority-weights.json")
    _assert_sums_to_one(config["weights"], "priority-weights.json weights")
    return config


def load_suitability_ahp() -> dict[str, Any]:
    config = _load_json("suitability-ahp.json")
    _assert_sums_to_one(config["weights"], "suitability-ahp.json weights")
    if config["consistencyRatio"] >= 0.10:
        raise ValueError(
            f"[ml/config] suitability-ahp.json consistencyRatio "
            f"({config['consistencyRatio']}) must be < 0.10"
        )
    return config


def load_capacity_norms() -> dict[str, Any]:
    return _load_json("capacity-norms.json")


def load_exclusion_criteria() -> dict[str, Any]:
    return _load_json("exclusion-criteria.json")


def load_factor_reclassification() -> dict[str, Any]:
    config = _load_json("factor-reclassification.json")
    for hazard, hazard_factors in HAZARD_WEIGHTS["hazards"].items():
        reclass_hazard = config["hazards"].get(hazard)
        if reclass_hazard is None:
            raise ValueError(
                f'[ml/config] factor-reclassification.json is missing hazard "{hazard}"'
            )
        weight_keys = sorted(hazard_factors["factors"].keys())
        reclass_keys = sorted(reclass_hazard.keys())
        if weight_keys != reclass_keys:
            raise ValueError(
                f"[ml/config] factor-reclassification.json hazards.{hazard} factor keys "
                f"{reclass_keys} do not match hazard-weights.json keys {weight_keys}"
            )
        for factor_name, entry in reclass_hazard.items():
            max_values = [bp["max"] for bp in entry["breakpoints"]]
            for i in range(len(max_values) - 1):
                current, nxt = max_values[i], max_values[i + 1]
                if current is None:
                    raise ValueError(
                        f"[ml/config] factor-reclassification.json hazards.{hazard}.{factor_name}: "
                        "only the last breakpoint may have max: null"
                    )
                if nxt is not None and nxt <= current:
                    raise ValueError(
                        f"[ml/config] factor-reclassification.json hazards.{hazard}.{factor_name}: "
                        "breakpoints must have strictly ascending max values"
                    )
            if max_values[-1] is not None:
                raise ValueError(
                    f"[ml/config] factor-reclassification.json hazards.{hazard}.{factor_name}: "
                    "the last breakpoint must have max: null"
                )
            ratings = [bp["rating"] for bp in entry["breakpoints"]]
            if ratings != [1, 2, 3, 4, 5]:
                raise ValueError(
                    f"[ml/config] factor-reclassification.json hazards.{hazard}.{factor_name}: "
                    "breakpoint ratings must be exactly [1,2,3,4,5] in order"
                )
    return config


def load_blend_config() -> dict[str, Any]:
    config = _load_json("blend-config.json")
    for hazard, hazard_config in config["hazards"].items():
        alpha = hazard_config["alpha"]
        if not (0.0 <= alpha <= 1.0):
            raise ValueError(
                f"[ml/config] blend-config.json hazards.{hazard}.alpha ({alpha}) must be in [0, 1]"
            )
    return config


def load_disaster_history() -> dict[str, Any]:
    config = _load_json("disaster-history.json")
    if not (0.0 <= config["maxBoost"] <= 1.0):
        raise ValueError(
            f"[ml/config] disaster-history.json maxBoost ({config['maxBoost']}) must be in [0, 1]"
        )
    if config["influenceRadiusKm"] <= 0 or config["halfLifeYears"] <= 0:
        raise ValueError(
            "[ml/config] disaster-history.json influenceRadiusKm and halfLifeYears must be positive"
        )
    return config


def load_compound_hazards() -> dict[str, Any]:
    config = _load_json("compound-hazards.json")
    for pair in config["pairs"]:
        if pair["trigger"] == pair["mechanism"]:
            raise ValueError(
                f"[ml/config] compound-hazards.json: a pair's trigger and mechanism must differ "
                f"(got \"{pair['trigger']}\" for both)"
            )
    return config


def _assert_factor_exists(hazard: str, factor: str, rule_label: str) -> None:
    hazard_config = HAZARD_WEIGHTS["hazards"].get(hazard)
    if hazard_config is None or factor not in hazard_config["factors"]:
        raise ValueError(
            f"[ml/config] scenario-parameters.json {rule_label}: factor \"{factor}\" is not one "
            f"of hazard-weights.json hazards.{hazard}.factors"
        )


def load_scenario_parameters() -> dict[str, Any]:
    """Single source of truth for how a scenario parameter (Step 8 Part 2)
    perturbs a causative factor — services/ml/app/engine/scenario.py loads
    this instead of hardcoding the mapping. Mirrors
    packages/shared/src/config/loader.ts::loadScenarioParameters()."""
    config = _load_json("scenario-parameters.json")
    for rule in config["rainfall"]["affects"]:
        _assert_factor_exists(rule["hazard"], rule["factor"], f"rainfall.affects[hazard={rule['hazard']}]")
    for rule in config["seaLevelRise"]["affects"]:
        _assert_factor_exists(rule["hazard"], rule["factor"], f"seaLevelRise.affects[hazard={rule['hazard']}]")
    for rule in config["cyclone"]["affects"]:
        _assert_factor_exists(rule["hazard"], rule["factor"], f"cyclone.affects[hazard={rule['hazard']}]")
    return config


def load_routing_costs() -> dict[str, Any]:
    """Step 10 Part 3A. Mirrors packages/shared/src/config/loader.ts::loadRoutingCosts()."""
    config = _load_json("routing-costs.json")
    m = config["zoneClassMultiplier"]
    if not (m["Green"] < m["Yellow"] < m["Orange"] < m["Red"]):
        raise ValueError(
            "[ml/config] routing-costs.json zoneClassMultiplier must be strictly increasing "
            f"Green<Yellow<Orange<Red, got Green={m['Green']}, Yellow={m['Yellow']}, "
            f"Orange={m['Orange']}, Red={m['Red']}"
        )
    s = config["routeSafetyWeight"]
    if not (s["Green"] >= s["Yellow"] >= s["Orange"] >= s["Red"]):
        raise ValueError(
            "[ml/config] routing-costs.json routeSafetyWeight must be non-increasing "
            f"Green>=Yellow>=Orange>=Red, got {s}"
        )
    return config


HAZARD_WEIGHTS = load_hazard_weights()
ZONE_THRESHOLDS = load_zone_thresholds()
VULNERABILITY_WEIGHTS = load_vulnerability_weights()
INDICATOR_NORMALIZATION = load_indicator_normalization()
PRIORITY_WEIGHTS = load_priority_weights()
SUITABILITY_AHP = load_suitability_ahp()
CAPACITY_NORMS = load_capacity_norms()
EXCLUSION_CRITERIA = load_exclusion_criteria()
FACTOR_RECLASSIFICATION = load_factor_reclassification()
BLEND_CONFIG = load_blend_config()
DISASTER_HISTORY = load_disaster_history()
COMPOUND_HAZARDS = load_compound_hazards()
SCENARIO_PARAMETERS = load_scenario_parameters()
ROUTING_COSTS = load_routing_costs()
