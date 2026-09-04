"""Site-to-habitation matching (METHODOLOGY §4/§5, Step 7 Commit 2's 2D).

For every Immediate/ShortTerm habitation, ranks all exclusion-surviving
candidate sites by suitability (computed fresh per habitation, since
`distanceFromOriginHabitation` and `livelihoodAccess` are habitation-
relative — see suitability.py), then greedily allocates the habitation's
households to its highest-ranked site that still has enough remaining
capacity. Allocation is priority-ordered (Immediate before ShortTerm,
then RPI descending) and many-to-one: a site's remaining capacity is
tracked cumulatively across the whole batch, so a high-capacity site can
absorb several habitations before it fills up, and a later, lower-
priority habitation can be pushed past a site a higher-priority
habitation already exhausted.

This module does not talk to a database — apps/api resolves habitations
and sites to plain inputs first, matching services/ml's "stateless engine"
convention used throughout (see disaster_history.py's docstring).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.engine.suitability import SuitabilityResult, compute_site_suitability

_PRIORITY_ORDER = {"Immediate": 0, "ShortTerm": 1}
_KM_PER_DEG_LAT = 110.57


def _distance_km(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    klon = 111.32 * math.cos(math.radians(lat0))
    return math.hypot((lon1 - lon0) * klon, (lat1 - lat0) * _KM_PER_DEG_LAT)


@dataclass
class ScoredSiteInput:
    site_id: str
    lon: float
    lat: float
    area_sqm: float
    land_ownership: str
    raw_attributes: dict
    hazard_safety_score: float
    effective_capacity: float


@dataclass
class HabitationInput:
    habitation_id: str
    lon: float
    lat: float
    # Habitation.livelihood has no separate coordinate for the livelihood
    # asset (farmland, fishing grounds, etc.) it references — only this
    # baseline distance from the CURRENT habitation. Livelihood assets are
    # fixed geographic features that do not relocate with the household,
    # so a candidate site's distance to that asset is approximated as
    # (site's distance from the habitation) + (habitation's own baseline
    # distance to the asset) — an upper-bound approximation, not an exact
    # bearing-aware calculation, since the asset's absolute position isn't
    # tracked anywhere in this project's data model.
    distance_to_livelihood_asset_km: float
    households: int
    priority_bucket: str
    relocation_priority_index: float


@dataclass
class RankedSite:
    site_id: str
    rank: int
    suitability_score: float
    sub_scores: dict[str, float]


@dataclass
class MatchResult:
    habitation_id: str
    ranked_sites: list[RankedSite]
    allocated_site_id: str | None
    allocated_households: int


_MAX_RANKED_SITES_RETURNED = 5


def match_habitations_to_sites(
    habitations: list[HabitationInput],
    sites: list[ScoredSiteInput],
) -> list[MatchResult]:
    sorted_habitations = sorted(
        habitations,
        key=lambda h: (_PRIORITY_ORDER.get(h.priority_bucket, len(_PRIORITY_ORDER)), -h.relocation_priority_index),
    )

    remaining_capacity: dict[str, float] = {s.site_id: s.effective_capacity for s in sites}
    results: list[MatchResult] = []

    for habitation in sorted_habitations:
        scored: list[tuple[str, SuitabilityResult]] = []
        for site in sites:
            distance_from_habitation_km = _distance_km(habitation.lon, habitation.lat, site.lon, site.lat)
            livelihood_distance_km = distance_from_habitation_km + habitation.distance_to_livelihood_asset_km
            suitability = compute_site_suitability(
                site.raw_attributes,
                site.area_sqm,
                site.land_ownership,
                site.hazard_safety_score,
                distance_from_habitation_km,
                livelihood_distance_km,
            )
            scored.append((site.site_id, suitability))
        scored.sort(key=lambda pair: pair[1].overall_score, reverse=True)

        ranked_sites = [
            RankedSite(
                site_id=site_id,
                rank=index + 1,
                suitability_score=suitability.overall_score,
                sub_scores=suitability.sub_scores,
            )
            for index, (site_id, suitability) in enumerate(scored)
        ]

        allocated_site_id: str | None = None
        for site_id, _suitability in scored:
            if remaining_capacity[site_id] >= habitation.households:
                allocated_site_id = site_id
                remaining_capacity[site_id] -= habitation.households
                break

        results.append(
            MatchResult(
                habitation_id=habitation.habitation_id,
                ranked_sites=ranked_sites[:_MAX_RANKED_SITES_RETURNED],
                allocated_site_id=allocated_site_id,
                allocated_households=habitation.households if allocated_site_id is not None else 0,
            )
        )

    return results
