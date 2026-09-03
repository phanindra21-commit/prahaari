"""Reclassifies raw causative-factor values to a 1-5 susceptibility rating,
per packages/shared/src/config/factor-reclassification.json (METHODOLOGY
§1.1). See app.config_loader.FACTOR_RECLASSIFICATION for the loaded,
cross-validated config (every factor's breakpoints are asserted ascending,
ending in max: null, with ratings exactly [1,2,3,4,5]).
"""

from __future__ import annotations

from app.config_loader import FACTOR_RECLASSIFICATION


def _table_rating(raw_value: float, breakpoints: list[dict]) -> int:
    for bp in breakpoints:
        if bp["max"] is None or raw_value <= bp["max"]:
            return bp["rating"]
    # Unreachable: the config loader asserts the last breakpoint's max is None.
    raise ValueError("factor-reclassification breakpoints must end with max: null")


def reclassify_value(raw_value: float, hazard: str, factor_name: str) -> int:
    """Maps one raw factor value to its 1-5 susceptibility rating.

    The DIRECT/INVERSE flip is applied uniformly here from the config's
    declared `direction` — never hardcoded per factor in calling code.
    """
    entry = FACTOR_RECLASSIFICATION["hazards"][hazard][factor_name]
    table_rating = _table_rating(raw_value, entry["breakpoints"])
    if entry["direction"] == "DIRECT":
        return table_rating
    return 6 - table_rating


def reclassify_cell(factors: dict[str, float], hazard: str) -> dict[str, int]:
    """Reclassifies every factor present for one grid cell + hazard."""
    return {
        factor_name: reclassify_value(raw_value, hazard, factor_name)
        for factor_name, raw_value in factors.items()
    }
