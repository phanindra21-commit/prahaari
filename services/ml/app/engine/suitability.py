"""AHP-weighted suitability scoring for candidate sites (METHODOLOGY §4.2).

    SSS = sum( W_j * normalize(C_j) )   for j in the 9 suitability criteria

Weights come from `packages/shared/src/config/suitability-ahp.json`'s
pairwise-comparison-derived weights (the config loader asserts
consistencyRatio < 0.10 at load time). Only sites that survive
exclusions.py are ever scored.

Two of the nine criteria — `distanceFromOriginHabitation` and
`livelihoodAccess` — are habitation-relative, not site-intrinsic: this
function takes them as parameters (in km) rather than reading them off
the site, so it can be called twice per site: once with a reference
habitation for the standalone `GET /sites` listing, and again per
(habitation, site) pair during site-to-habitation matching
(site_matching.py) with that habitation's real distances.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry

from app.config_loader import SUITABILITY_AHP

LAND_OWNERSHIP_EASE: dict[str, float] = {
    "GOVT": 1.0,
    "COMMUNITY": 0.6,
    "PRIVATE": 0.35,
    "FOREST": 0.1,
}

# Reference ranges normalizing each raw/derived attribute to [0,1] — same
# REFERENCE_RANGE convention as indicator-normalization.json (a clamped
# raw value scaled against a chosen realistic planning range).
_AREA_SQM_RANGE = (20_000.0, 80_000.0)
_WATER_SUPPLY_LPD_RANGE = (5_000.0, 60_000.0)
_ROAD_DISTANCE_M_RANGE = (0.0, 2_000.0)
_HABITATION_DISTANCE_KM_RANGE = (0.0, 30.0)
_LIVELIHOOD_DISTANCE_KM_RANGE = (0.0, 10.0)
_SLOPE_DEGREES_RANGE = (0.0, 20.0)  # already hard-excluded above 20 degrees
_HAZARD_PROXIMITY_KM_RANGE = (0.0, 5.0)

_KM_PER_DEGREE = 111.0  # equirectangular approximation, consistent with derive_factors.py at this scale


def _normalize(value: float, lo: float, hi: float, *, inverse: bool = False) -> float:
    clamped = max(lo, min(hi, value))
    scaled = (clamped - lo) / (hi - lo) if hi > lo else 0.0
    return 1.0 - scaled if inverse else scaled


def compute_hazard_safety(site_geometry: BaseGeometry, red_orange_zone_geoms: list[BaseGeometry]) -> float:
    """1.0 (safest) far from every residual Red/Orange zone, decaying to 0
    as the site approaches one — the site has already passed the hard
    exclusion (§4.1: must not literally intersect a Red/Orange zone), so
    this captures RESIDUAL proximity risk among sites that already
    cleared that bar, independently of the hard filter."""
    if not red_orange_zone_geoms:
        return 1.0
    nearest_km = min(site_geometry.distance(g) for g in red_orange_zone_geoms) * _KM_PER_DEGREE
    return _normalize(nearest_km, *_HAZARD_PROXIMITY_KM_RANGE)


@dataclass
class SuitabilityResult:
    sub_scores: dict[str, float]
    overall_score: float


def compute_site_suitability(
    raw_attributes: dict,
    area_sqm: float,
    land_ownership: str,
    hazard_safety_score: float,
    distance_from_habitation_km: float,
    livelihood_distance_km: float,
) -> SuitabilityResult:
    sub_scores = {
        "hazardSafety": max(0.0, min(1.0, hazard_safety_score)),
        "waterAvailability": _normalize(raw_attributes["availableWaterSupplyLpd"], *_WATER_SUPPLY_LPD_RANGE),
        "landAvailability": _normalize(area_sqm, *_AREA_SQM_RANGE),
        "roadConnectivity": _normalize(
            raw_attributes["distanceToAllWeatherRoadM"], *_ROAD_DISTANCE_M_RANGE, inverse=True
        ),
        "distanceFromOriginHabitation": _normalize(
            distance_from_habitation_km, *_HABITATION_DISTANCE_KM_RANGE, inverse=True
        ),
        "livelihoodAccess": _normalize(livelihood_distance_km, *_LIVELIHOOD_DISTANCE_KM_RANGE, inverse=True),
        "landOwnershipAcquisitionEase": LAND_OWNERSHIP_EASE.get(land_ownership, 0.3),
        "existingInfrastructure": max(0.0, min(1.0, raw_attributes["existingInfrastructureIndex"])),
        "slope": _normalize(raw_attributes["slopeDegrees"], *_SLOPE_DEGREES_RANGE, inverse=True),
    }
    weights = SUITABILITY_AHP["weights"]
    overall = sum(weights[criterion] * score for criterion, score in sub_scores.items())
    return SuitabilityResult(sub_scores=sub_scores, overall_score=max(0.0, min(1.0, overall)))
