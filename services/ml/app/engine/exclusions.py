"""Hard exclusion filters for candidate relocation sites (METHODOLOGY §4.1).

Applied BEFORE any suitability scoring: a site failing ANY criterion is
removed from consideration entirely, regardless of how well it performs
on other factors. Source of truth for the criteria list:
packages/shared/src/config/exclusion-criteria.json.

`insideRedOrOrangeZone` is the one criterion computed from REAL geometry
(the site polygon intersected against this district's active Red/Orange
HazardZone geometry, of any hazard type). Every other criterion has no
real GIS layer in this project (no CRZ shapefile, no forest boundary
data, no fault-line inventory) — they are evaluated against
`RelocationSite.rawAttributes`, deterministically-assigned SYNTHETIC_DEMO
values (see services/ml/scripts/add_site_attributes.py), through the
SAME rule-evaluation logic a real GIS layer would feed. The rules
themselves are real; only their inputs are synthetic where a real layer
does not exist yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shapely.geometry.base import BaseGeometry

from app.config_loader import EXCLUSION_CRITERIA

_LAYER_TO_FLAG: dict[str, str] = {
    "CRZ_I": "inCrzI",
    "FOREST_PROTECTED": "inProtectedForest",
    "FLOODPLAIN_100YR": "inFloodplain100yr",
    "MINING_LEASE": "inMiningLease",
}

_LAYER_TO_DISTANCE_FIELD: dict[str, str] = {
    "ACTIVE_FAULT": "distanceToActiveFaultM",
    "WATER_BODY": "distanceToWaterBodyM",
}


@dataclass
class ExclusionResult:
    passed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)

    @property
    def excluded(self) -> bool:
        return len(self.failed) > 0


def _passes(
    rule: str,
    params: dict,
    site_geometry: BaseGeometry,
    raw_attributes: dict,
    red_orange_zone_geoms: list[BaseGeometry],
) -> bool:
    """True if the site PASSES this criterion (i.e. is NOT excluded by it)."""
    if rule == "INTERSECTS_ZONE_CLASS":
        return not any(site_geometry.intersects(g) for g in red_orange_zone_geoms)
    if rule == "INTERSECTS_LAYER":
        flag = _LAYER_TO_FLAG[params["layer"]]
        return not raw_attributes[flag]
    if rule == "SLOPE_EXCEEDS_DEGREES":
        return raw_attributes["slopeDegrees"] <= params["maxDegrees"]
    if rule == "WITHIN_BUFFER":
        distance_field = _LAYER_TO_DISTANCE_FIELD[params["layer"]]
        return raw_attributes[distance_field] > params["bufferMeters"]
    raise ValueError(f"[exclusions] Unknown exclusion rule: {rule}")


def evaluate_exclusions(
    site_geometry: BaseGeometry,
    raw_attributes: dict,
    red_orange_zone_geoms: list[BaseGeometry],
) -> ExclusionResult:
    """Evaluates every configured criterion against one site. Every
    criterion is checked (not short-circuited) so `failed` always lists
    every reason a site was excluded, not just the first one found."""
    result = ExclusionResult()
    for criterion in EXCLUSION_CRITERIA["criteria"]:
        ok = _passes(criterion["rule"], criterion["params"], site_geometry, raw_attributes, red_orange_zone_geoms)
        (result.passed if ok else result.failed).append(criterion["id"])
    return result
