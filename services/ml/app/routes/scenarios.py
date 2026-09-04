"""Step 8 Part 2D — the live scenario-simulation endpoint apps/api's
scenario route calls once per POST /api/v1/scenarios/run. Every field
crossing this boundary is Pydantic-validated per CLAUDE.md's "validate
at every API boundary" rule.

services/ml stays stateless (docs/ARCHITECTURE.md): grid cells, habitation
attributes, and hazard-event history are supplied in the request body,
never read from MongoDB here. Nothing here is persisted — the response is
written onto a ScenarioRun document by apps/api; the district's active
HazardZone/Assessment documents are never touched.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.config_loader import HAZARD_WEIGHTS
from app.engine.assessment import HabitationInput
from app.engine.disaster_history import HazardEventPoint
from app.engine.pipeline import CellInput
from app.engine.scenario import ScenarioParams, run_district_scenario
from app.engine.zones import geometry_to_geojson

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

HazardType = Literal["landslide", "flood", "coastalErosion", "cloudburst"]
ZoneClass = Literal["Red", "Orange", "Yellow", "Green"]
PriorityBucket = Literal["Immediate", "ShortTerm", "MediumTerm"]


class CellRequest(BaseModel):
    h3Index: str
    district: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    factors: dict[str, float]


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


class HazardEventRequest(BaseModel):
    hazardType: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    date: datetime


class ScenarioParametersRequest(BaseModel):
    rainfallMmPer24h: float | None = Field(default=None, gt=0)
    seaLevelRiseM: float | None = Field(default=None, gt=0)
    cycloneCategory: Literal[1, 2, 3, 4, 5] | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "ScenarioParametersRequest":
        if self.rainfallMmPer24h is None and self.seaLevelRiseM is None and self.cycloneCategory is None:
            raise ValueError("At least one scenario parameter must be set")
        return self


class ScenarioRunRequest(BaseModel):
    hazardCells: dict[HazardType, list[CellRequest]] = Field(min_length=1)
    hazardEventPoints: dict[HazardType, list[tuple[float, float]]] = Field(default_factory=dict)
    habitations: list[HabitationRequest] = Field(min_length=1)
    hazardEvents: list[HazardEventRequest] = Field(default_factory=list)
    parameters: ScenarioParametersRequest


class HazardCellSummaryOut(BaseModel):
    hazard: HazardType
    affected: bool
    baselineZoneCounts: dict[ZoneClass, int]
    scenarioZoneCounts: dict[ZoneClass, int]
    cellsChanged: int
    newlyRedCells: int


class CellClassTransitionOut(BaseModel):
    hazard: HazardType
    fromClass: ZoneClass
    toClass: ZoneClass
    cellCount: int


class HabitationDeltaOut(BaseModel):
    habitationId: str
    baselineOverallZoneClass: ZoneClass
    scenarioOverallZoneClass: ZoneClass
    baselinePriorityBucket: PriorityBucket | None
    scenarioPriorityBucket: PriorityBucket | None
    enteredImmediate: bool
    zoneClassWorsened: bool


class HazardZoneGeometryOut(BaseModel):
    hazard: HazardType
    baseline: dict[ZoneClass, dict]
    scenario: dict[ZoneClass, dict]
    changed: dict | None


class ScenarioRunResponse(BaseModel):
    hazardSummaries: list[HazardCellSummaryOut]
    cellTransitions: list[CellClassTransitionOut]
    habitationDeltas: list[HabitationDeltaOut]
    habitationsEnteringImmediate: list[str]
    zoneGeometries: list[HazardZoneGeometryOut]
    runtimeSeconds: float


@router.post("/run", response_model=ScenarioRunResponse)
def run_scenario(request: ScenarioRunRequest) -> ScenarioRunResponse:
    for hazard, cells in request.hazardCells.items():
        required_factors = set(HAZARD_WEIGHTS["hazards"][hazard]["factors"].keys())
        for cell in cells:
            missing = required_factors - cell.factors.keys()
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail=f"cell {cell.h3Index} is missing required factor(s) for {hazard}: {sorted(missing)}",
                )

    hazard_cells = {
        hazard: [CellInput(c.h3Index, c.district, c.lon, c.lat, c.factors) for c in cells]
        for hazard, cells in request.hazardCells.items()
    }
    hazard_event_points = {hazard: list(points) for hazard, points in request.hazardEventPoints.items()}

    habitations = [
        HabitationInput(
            habitation_id=h.habitationId,
            lon=h.lon,
            lat=h.lat,
            households=h.households,
            attributes={
                "demographics": h.demographics,
                "structures": h.structures,
                "access": h.access,
                "livelihood": h.livelihood,
                "copingCapacity": h.copingCapacity,
            },
        )
        for h in request.habitations
    ]
    hazard_events = [
        HazardEventPoint(hazard_type=e.hazardType, lon=e.lon, lat=e.lat, date=e.date) for e in request.hazardEvents
    ]

    params = ScenarioParams(
        rainfall_mm_per_24h=request.parameters.rainfallMmPer24h,
        sea_level_rise_m=request.parameters.seaLevelRiseM,
        cyclone_category=request.parameters.cycloneCategory,
    )

    try:
        result = run_district_scenario(
            hazard_cells, hazard_event_points, habitations, hazard_events, params, datetime.now(timezone.utc)
        )
    except (ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ScenarioRunResponse(
        hazardSummaries=[
            HazardCellSummaryOut(
                hazard=s.hazard,
                affected=s.affected,
                baselineZoneCounts=s.baseline_zone_counts,
                scenarioZoneCounts=s.scenario_zone_counts,
                cellsChanged=s.cells_changed,
                newlyRedCells=s.newly_red_cells,
            )
            for s in result.hazard_summaries
        ],
        cellTransitions=[
            CellClassTransitionOut(hazard=t.hazard, fromClass=t.from_class, toClass=t.to_class, cellCount=t.cell_count)
            for t in result.cell_transitions
        ],
        habitationDeltas=[
            HabitationDeltaOut(
                habitationId=d.habitation_id,
                baselineOverallZoneClass=d.baseline_overall_zone_class,
                scenarioOverallZoneClass=d.scenario_overall_zone_class,
                baselinePriorityBucket=d.baseline_priority_bucket,
                scenarioPriorityBucket=d.scenario_priority_bucket,
                enteredImmediate=d.entered_immediate,
                zoneClassWorsened=d.zone_class_worsened,
            )
            for d in result.habitation_deltas
        ],
        habitationsEnteringImmediate=result.habitations_entering_immediate,
        zoneGeometries=[
            HazardZoneGeometryOut(
                hazard=g.hazard,
                baseline={zc: geometry_to_geojson(geom) for zc, geom in g.baseline.items()},
                scenario={zc: geometry_to_geojson(geom) for zc, geom in g.scenario.items()},
                changed=geometry_to_geojson(g.changed) if g.changed is not None else None,
            )
            for g in result.zone_geometries
        ],
        runtimeSeconds=result.runtime_seconds,
    )
