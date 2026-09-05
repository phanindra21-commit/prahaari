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

Step 10 Part 3C adds an optional route-safety re-rank: when `grid_cells`
is supplied, the top `_MAX_RANKED_SITES_RETURNED` sites by pure AHP
suitability (already the exact list returned to the caller) are re-sorted
by `overall_score * (1 - w + w * route_safety_score)` — a documented
post-AHP adjustment (`routing-costs.json`'s `routeSafetyAdjustmentWeight`,
w) that can only ever reduce a site's effective score for a risky
corridor, never boost one above its pure AHP score. The AHP pairwise
matrix (suitability-ahp.json) and every `suitability_score` reported to
the caller are never touched by this. `grid_cells` is optional and
defaults to `None`, in which case behavior is byte-for-byte identical to
before this feature existed (no route computed, no re-rank) — every
caller that doesn't yet supply grid cells keeps working exactly as before.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.config_loader import ROUTING_COSTS
from app.engine.routing import GridCellForRouting, RouteResult, compute_route
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
    # Step 10 Part 3B/3C. `suitability_score` above is always the pure AHP
    # score, untouched — `route` and `route_safety_score` are the routing
    # engine's output for this (habitation, site) pair (None when no
    # `grid_cells` were supplied to `match_habitations_to_sites`, or when
    # no path could be found), and `rank` reflects the post-AHP adjustment
    # (see this module's docstring) only among the top
    # `_MAX_RANKED_SITES_RETURNED` sites already selected by suitability —
    # a route-safety edge can reorder which of those already-shortlisted
    # sites appears first, never pull in a site that suitability alone
    # would not already have shortlisted.
    route: RouteResult | None = None
    route_safety_score: float | None = None


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
    grid_cells: list[GridCellForRouting] | None = None,
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

        shortlist = scored[:_MAX_RANKED_SITES_RETURNED]
        sites_by_id = {s.site_id: s for s in sites}
        adjustment_weight = ROUTING_COSTS["routeSafetyAdjustmentWeight"]

        routed: list[tuple[str, SuitabilityResult, RouteResult | None, float]] = []
        for site_id, suitability in shortlist:
            route: RouteResult | None = None
            if grid_cells:
                site = sites_by_id[site_id]
                route = compute_route(habitation.lon, habitation.lat, site.lon, site.lat, grid_cells)
            if route is not None:
                adjusted = suitability.overall_score * (
                    1 - adjustment_weight + adjustment_weight * route.route_safety_score
                )
            else:
                adjusted = suitability.overall_score
            routed.append((site_id, suitability, route, adjusted))
        routed.sort(key=lambda entry: entry[3], reverse=True)

        ranked_sites = [
            RankedSite(
                site_id=site_id,
                rank=index + 1,
                suitability_score=suitability.overall_score,
                sub_scores=suitability.sub_scores,
                route=route,
                route_safety_score=route.route_safety_score if route is not None else None,
            )
            for index, (site_id, suitability, route, _adjusted) in enumerate(routed)
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
