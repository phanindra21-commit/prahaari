"""Relocation-site scoring endpoint: exclusions, AHP suitability, carrying
capacity, and habitation-to-site matching (METHODOLOGY §4/§5, Step 7
Commit 2). apps/api's pipeline job worker calls this once per district
after hazard zoning and habitation assessment have both run, supplying
this district's Red/Orange hazard-zone geometry, every RelocationSite's
raw attributes, and every Immediate/ShortTerm habitation to match against.

services/ml stays stateless (docs/ARCHITECTURE.md): nothing here reads
MongoDB or the local filesystem — every input crosses the HTTP boundary
as a Pydantic model, per CLAUDE.md's "validate at every API boundary" rule.
"""

from __future__ import annotations

import math
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from shapely.errors import ShapelyError
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from app.engine.capacity import compute_carrying_capacity
from app.engine.exclusions import evaluate_exclusions
from app.engine.site_matching import HabitationInput as MatchHabitationInput
from app.engine.site_matching import ScoredSiteInput, match_habitations_to_sites
from app.engine.suitability import compute_hazard_safety, compute_site_suitability

router = APIRouter(prefix="/sites", tags=["sites"])

LandOwnership = Literal["GOVT", "PRIVATE", "COMMUNITY", "FOREST"]
TerrainTier = Literal["HILLY_TRIBAL", "PLAINS"]
BindingConstraint = Literal["LAND", "WATER", "EDUCATION", "HEALTH", "ACCESS"]
PriorityBucket = Literal["Immediate", "ShortTerm", "MediumTerm"]


def _distance_km(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    klon = 111.32 * math.cos(math.radians(lat0))
    return math.hypot((lon1 - lon0) * klon, (lat1 - lat0) * 110.57)


class RawAttributesRequest(BaseModel):
    slopeDegrees: float = Field(ge=0)
    inCrzI: bool
    inProtectedForest: bool
    inFloodplain100yr: bool
    distanceToActiveFaultM: float = Field(ge=0)
    distanceToWaterBodyM: float = Field(ge=0)
    inMiningLease: bool
    distanceToAllWeatherRoadM: float = Field(ge=0)
    availableWaterSupplyLpd: float = Field(ge=0)
    nearbySchoolSpareCapacitySeats: float = Field(ge=0)
    nearbyHealthFacilitySpareCapacityPopulation: float = Field(ge=0)
    existingInfrastructureIndex: float = Field(ge=0, le=1)


class SiteRequest(BaseModel):
    siteId: str
    geometry: dict
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    areaSqm: float = Field(gt=0)
    landOwnership: LandOwnership
    rawAttributes: RawAttributesRequest


class HabitationForMatchingRequest(BaseModel):
    habitationId: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    distanceToLivelihoodAssetKm: float = Field(ge=0)
    households: int = Field(ge=0)
    priorityBucket: PriorityBucket
    relocationPriorityIndex: float = Field(ge=0, le=1)


class SiteScoringRunRequest(BaseModel):
    state: str
    terrainTier: TerrainTier
    redOrangeZoneGeometries: list[dict] = Field(default_factory=list)
    sites: list[SiteRequest] = Field(min_length=1)
    habitations: list[HabitationForMatchingRequest] = Field(default_factory=list)


class ExclusionsOut(BaseModel):
    passed: list[str]
    failed: list[str]
    excluded: bool


class CapacityOut(BaseModel):
    byLand: float
    byWater: float
    byEducation: float
    byHealth: float
    byAccess: float
    effectiveCapacity: float
    bindingConstraint: BindingConstraint


class SiteOut(BaseModel):
    siteId: str
    exclusions: ExclusionsOut
    suitabilitySubScores: dict[str, float] | None
    overallSuitabilityScore: float | None
    carryingCapacity: CapacityOut | None


class RankedSiteOut(BaseModel):
    siteId: str
    rank: int
    suitabilityScore: float
    subScores: dict[str, float]


class MatchOut(BaseModel):
    habitationId: str
    rankedSites: list[RankedSiteOut]
    allocatedSiteId: str | None
    allocatedHouseholds: int


class SiteScoringRunResponse(BaseModel):
    sites: list[SiteOut]
    matches: list[MatchOut]


@router.post("/run", response_model=SiteScoringRunResponse)
def run_site_scoring(request: SiteScoringRunRequest) -> SiteScoringRunResponse:
    try:
        zone_geoms: list[BaseGeometry] = [shape(g) for g in request.redOrangeZoneGeometries]
        site_geoms: dict[str, BaseGeometry] = {s.siteId: shape(s.geometry) for s in request.sites}
    except (ValueError, AttributeError, KeyError, ShapelyError) as error:
        raise HTTPException(status_code=422, detail=f"invalid geometry: {error}") from error

    eligible_habitations = [
        h for h in request.habitations if h.priorityBucket in ("Immediate", "ShortTerm")
    ]

    site_out_by_id: dict[str, SiteOut] = {}
    scored_sites_for_matching: list[ScoredSiteInput] = []

    for site in request.sites:
        raw = site.rawAttributes.model_dump()
        geometry = site_geoms[site.siteId]
        exclusion_result = evaluate_exclusions(geometry, raw, zone_geoms)

        if exclusion_result.excluded:
            site_out_by_id[site.siteId] = SiteOut(
                siteId=site.siteId,
                exclusions=ExclusionsOut(
                    passed=exclusion_result.passed, failed=exclusion_result.failed, excluded=True
                ),
                suitabilitySubScores=None,
                overallSuitabilityScore=None,
                carryingCapacity=None,
            )
            continue

        hazard_safety = compute_hazard_safety(geometry, zone_geoms)
        capacity = compute_carrying_capacity(raw, site.areaSqm, request.state, request.terrainTier)

        # The reference habitation for a site's STANDALONE listing score
        # (as opposed to a per-habitation matching score, computed again
        # below) is the nearest Immediate/ShortTerm habitation to this
        # site — the habitation most likely to actually be sent here.
        reference_habitation = min(
            eligible_habitations,
            key=lambda h: _distance_km(h.lon, h.lat, site.lon, site.lat),
            default=None,
        )
        if reference_habitation is not None:
            distance_from_habitation_km = _distance_km(
                reference_habitation.lon, reference_habitation.lat, site.lon, site.lat
            )
            livelihood_distance_km = (
                distance_from_habitation_km + reference_habitation.distanceToLivelihoodAssetKm
            )
        else:
            distance_from_habitation_km = 0.0
            livelihood_distance_km = 0.0

        suitability = compute_site_suitability(
            raw,
            site.areaSqm,
            site.landOwnership,
            hazard_safety,
            distance_from_habitation_km,
            livelihood_distance_km,
        )

        site_out_by_id[site.siteId] = SiteOut(
            siteId=site.siteId,
            exclusions=ExclusionsOut(
                passed=exclusion_result.passed, failed=exclusion_result.failed, excluded=False
            ),
            suitabilitySubScores=suitability.sub_scores,
            overallSuitabilityScore=suitability.overall_score,
            carryingCapacity=CapacityOut(
                byLand=capacity.by_land,
                byWater=capacity.by_water,
                byEducation=capacity.by_education,
                byHealth=capacity.by_health,
                byAccess=capacity.by_access,
                effectiveCapacity=capacity.effective_capacity,
                bindingConstraint=capacity.binding_constraint,
            ),
        )
        scored_sites_for_matching.append(
            ScoredSiteInput(
                site_id=site.siteId,
                lon=site.lon,
                lat=site.lat,
                area_sqm=site.areaSqm,
                land_ownership=site.landOwnership,
                raw_attributes=raw,
                hazard_safety_score=hazard_safety,
                effective_capacity=capacity.effective_capacity,
            )
        )

    match_inputs = [
        MatchHabitationInput(
            habitation_id=h.habitationId,
            lon=h.lon,
            lat=h.lat,
            distance_to_livelihood_asset_km=h.distanceToLivelihoodAssetKm,
            households=h.households,
            priority_bucket=h.priorityBucket,
            relocation_priority_index=h.relocationPriorityIndex,
        )
        for h in eligible_habitations
    ]
    match_results = match_habitations_to_sites(match_inputs, scored_sites_for_matching)

    matches_out = [
        MatchOut(
            habitationId=m.habitation_id,
            rankedSites=[
                RankedSiteOut(
                    siteId=r.site_id, rank=r.rank, suitabilityScore=r.suitability_score, subScores=r.sub_scores
                )
                for r in m.ranked_sites
            ],
            allocatedSiteId=m.allocated_site_id,
            allocatedHouseholds=m.allocated_households,
        )
        for m in match_results
    ]

    return SiteScoringRunResponse(
        sites=[site_out_by_id[s.siteId] for s in request.sites],
        matches=matches_out,
    )
