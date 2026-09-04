"""Live habitation-assessment endpoint apps/api's pipeline job worker calls
once per district. Every field crossing this boundary is Pydantic-validated
per CLAUDE.md's "validate at every API boundary" rule.

services/ml stays stateless (docs/ARCHITECTURE.md): habitation attributes
and dissolved hazard-zone geometry are supplied in the request body, never
read from MongoDB or the local filesystem here.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from shapely.geometry import shape

from app.engine.assessment import assess_habitation

router = APIRouter(prefix="/assessment", tags=["assessment"])

ZoneClass = Literal["Red", "Orange", "Yellow", "Green"]
ExplanationDirection = Literal["INCREASES_RISK", "DECREASES_RISK"]


class ZoneClassEntry(BaseModel):
    zoneClass: ZoneClass
    geometry: dict
    hazardScore: float = Field(ge=0, le=1)


class HabitationRequest(BaseModel):
    habitationId: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    households: int = Field(ge=0)
    demographics: dict[str, float]
    structures: dict
    access: dict
    livelihood: dict
    copingCapacity: dict


class AssessmentRunRequest(BaseModel):
    hazardZones: dict[str, list[ZoneClassEntry]] = Field(min_length=1)
    habitations: list[HabitationRequest] = Field(min_length=1)


class HazardExposureOut(BaseModel):
    hazardType: str
    hazardScore: float
    exposure: float
    zoneClass: ZoneClass


class ContributionOut(BaseModel):
    factor: str
    contribution: float
    direction: ExplanationDirection
    label: str


class VulnerabilityDimensionsOut(BaseModel):
    demographic: float
    socioeconomic: float
    structural: float
    accessibility: float


class AssessmentOut(BaseModel):
    habitationId: str
    hazardExposure: list[HazardExposureOut]
    vulnerabilityIndex: float
    vulnerabilityDimensions: VulnerabilityDimensionsOut
    copingCapacity: float
    compositeRiskScore: float
    governingHazard: str
    overallZoneClass: ZoneClass
    relocationPriorityIndex: float | None
    priorityBucket: Literal["Immediate", "ShortTerm", "MediumTerm"] | None
    explanation: list[ContributionOut]


class AssessmentRunResponse(BaseModel):
    assessments: list[AssessmentOut]


@router.post("/run", response_model=AssessmentRunResponse)
def run_assessment(request: AssessmentRunRequest) -> AssessmentRunResponse:
    try:
        zone_geoms: dict[str, dict[str, object]] = {}
        zone_scores: dict[str, dict[str, float]] = {}
        for hazard_type, entries in request.hazardZones.items():
            zone_geoms[hazard_type] = {entry.zoneClass: shape(entry.geometry) for entry in entries}
            zone_scores[hazard_type] = {entry.zoneClass: entry.hazardScore for entry in entries}
    except (ValueError, AttributeError) as error:
        raise HTTPException(status_code=422, detail=f"invalid zone geometry: {error}") from error

    assessments = []
    for habitation in request.habitations:
        try:
            result = assess_habitation(
                habitation_id=habitation.habitationId,
                lon=habitation.lon,
                lat=habitation.lat,
                households=habitation.households,
                habitation_attributes={
                    "demographics": habitation.demographics,
                    "structures": habitation.structures,
                    "access": habitation.access,
                    "livelihood": habitation.livelihood,
                    "copingCapacity": habitation.copingCapacity,
                },
                hazard_zone_geoms=zone_geoms,
                hazard_zone_scores=zone_scores,
            )
        except (KeyError, ValueError) as error:
            raise HTTPException(
                status_code=422,
                detail=f"habitation {habitation.habitationId}: {error}",
            ) from error

        assessments.append(
            AssessmentOut(
                habitationId=result.habitation_id,
                hazardExposure=[
                    HazardExposureOut(
                        hazardType=e.hazard_type,
                        hazardScore=e.hazard_score,
                        exposure=e.exposure,
                        zoneClass=e.zone_class,
                    )
                    for e in result.hazard_exposure
                ],
                vulnerabilityIndex=result.vulnerability_index,
                vulnerabilityDimensions=VulnerabilityDimensionsOut(**result.vulnerability_dimensions),
                copingCapacity=result.coping_capacity,
                compositeRiskScore=result.composite_risk_score,
                governingHazard=result.governing_hazard,
                overallZoneClass=result.overall_zone_class,
                relocationPriorityIndex=result.relocation_priority_index,
                priorityBucket=result.priority_bucket,
                explanation=[ContributionOut(**c) for c in result.explanation],
            )
        )

    return AssessmentRunResponse(assessments=assessments)
