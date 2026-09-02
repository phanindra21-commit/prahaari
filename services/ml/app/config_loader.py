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


HAZARD_WEIGHTS = load_hazard_weights()
ZONE_THRESHOLDS = load_zone_thresholds()
VULNERABILITY_WEIGHTS = load_vulnerability_weights()
PRIORITY_WEIGHTS = load_priority_weights()
SUITABILITY_AHP = load_suitability_ahp()
CAPACITY_NORMS = load_capacity_norms()
EXCLUSION_CRITERIA = load_exclusion_criteria()
