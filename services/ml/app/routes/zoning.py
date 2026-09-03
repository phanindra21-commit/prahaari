"""Live scoring endpoint apps/api's zoning job worker calls per (district,
hazard). Every field crossing this boundary is Pydantic-validated per
CLAUDE.md's "validate at every API boundary" rule — never trust the
request body or hand back an unvalidated response.

services/ml stays stateless (docs/ARCHITECTURE.md): all cell data and
real event points are supplied in the request body, never read from
MongoDB or the local filesystem here.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config_loader import HAZARD_WEIGHTS
from app.engine.pipeline import CellInput, score_cells
from app.engine.zones import classify_zone, dissolve_zone_class, geometry_to_geojson

router = APIRouter(prefix="/zoning", tags=["zoning"])

HazardType = Literal["landslide", "flood", "coastalErosion", "cloudburst"]
ZoneClass = Literal["Red", "Orange", "Yellow", "Green"]


class CellRequest(BaseModel):
    h3Index: str
    district: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    factors: dict[str, float]


class ZoningRunRequest(BaseModel):
    hazardType: HazardType
    cells: list[CellRequest] = Field(min_length=1)
    eventPoints: list[tuple[float, float]] = Field(default_factory=list)


class FactorContribution(BaseModel):
    factor: str
    contribution: float
    direction: Literal["INCREASES_RISK", "DECREASES_RISK"]


class CellScore(BaseModel):
    h3Index: str
    district: str
    overlayScore: float
    mlScore: float
    blendedScore: float
    zoneClass: ZoneClass
    topFactors: list[FactorContribution]


class ZonePolygon(BaseModel):
    district: str
    zoneClass: ZoneClass
    cellCount: int
    geometry: dict
    simplifiedGeometry: dict


class ModelMetricsOut(BaseModel):
    aucRoc: float
    precision: float
    recall: float
    f1: float
    calibrationError: float


class ZoningRunResponse(BaseModel):
    hazardType: HazardType
    cellScores: list[CellScore]
    zones: list[ZonePolygon]
    metrics: ModelMetricsOut
    featureList: list[str]
    trainingSampleCount: int
    labelSource: str


@router.post("/run", response_model=ZoningRunResponse)
def run_zoning(request: ZoningRunRequest) -> ZoningRunResponse:
    required_factors = set(HAZARD_WEIGHTS["hazards"][request.hazardType]["factors"].keys())
    for cell in request.cells:
        missing = required_factors - cell.factors.keys()
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"cell {cell.h3Index} is missing required factor(s) for "
                f"{request.hazardType}: {sorted(missing)}",
            )

    cells = [
        CellInput(c.h3Index, c.district, c.lon, c.lat, c.factors) for c in request.cells
    ]

    try:
        result = score_cells(request.hazardType, cells, request.eventPoints)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    cell_scores = [
        CellScore(
            h3Index=h3_index,
            district=district,
            overlayScore=float(overlay),
            mlScore=float(ml),
            blendedScore=float(blended),
            zoneClass=classify_zone(float(blended), request.hazardType),
            topFactors=[FactorContribution(**f) for f in factors],
        )
        for h3_index, district, overlay, ml, blended, factors in zip(
            result.h3_indexes,
            result.districts,
            result.overlay_scores,
            result.ml_scores,
            result.blended_scores,
            result.top_factors,
        )
    ]

    cells_by_group: dict[tuple[str, str], list[str]] = {}
    for cell_score in cell_scores:
        cells_by_group.setdefault((cell_score.district, cell_score.zoneClass), []).append(
            cell_score.h3Index
        )

    zones = []
    for (district, zone_class), h3_indexes in sorted(cells_by_group.items()):
        full, simplified = dissolve_zone_class(h3_indexes)
        zones.append(
            ZonePolygon(
                district=district,
                zoneClass=zone_class,
                cellCount=len(h3_indexes),
                geometry=geometry_to_geojson(full),
                simplifiedGeometry=geometry_to_geojson(simplified),
            )
        )

    return ZoningRunResponse(
        hazardType=request.hazardType,
        cellScores=cell_scores,
        zones=zones,
        metrics=ModelMetricsOut(**result.trained.metrics),
        featureList=result.feature_list,
        trainingSampleCount=result.trained.training_sample_count,
        labelSource=result.label_source,
    )
