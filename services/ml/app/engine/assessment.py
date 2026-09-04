"""Orchestrates one habitation's full assessment: hazard exposure, VI +
CopingCapacity, Risk + the governing (worst) hazard, and — only when the
habitation's OVERALL zone class (METHODOLOGY §1.3's multi-hazard
aggregation, zones.py::aggregate_multi_hazard) is Red or Orange — RPI +
priority bucket + a top-5 signed contribution breakdown.

A pure function: no MongoDB, no FastAPI — `app/routes/assessment.py` is
the thin request/response wrapper; `apps/api`'s job worker supplies every
input (habitation attributes, dissolved zone geometry, per-zone-class
hazard scores) so services/ml never touches persistence, per
docs/ARCHITECTURE.md.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry

from app.engine.priority import bucket_for_rpi, compute_rpi, rpi_contributions
from app.engine.risk import compute_exposure, compute_risk, governing_risk, habitation_footprint
from app.engine.vulnerability import compute_vulnerability
from app.engine.zones import aggregate_multi_hazard


@dataclass
class HazardExposureResult:
    hazard_type: str
    hazard_score: float
    exposure: float
    zone_class: str


@dataclass
class AssessmentResult:
    habitation_id: str
    hazard_exposure: list[HazardExposureResult]
    vulnerability_index: float
    vulnerability_dimensions: dict[str, float]
    coping_capacity: float
    composite_risk_score: float
    governing_hazard: str
    overall_zone_class: str
    relocation_priority_index: float | None
    priority_bucket: str | None
    explanation: list[dict]


def _dominant_zone_class(footprint: BaseGeometry, zone_geoms_by_class: dict[str, BaseGeometry]) -> str:
    """The zone class covering the largest share of the footprint's area — the
    "primary" class this habitation sits in, used to look up a single
    representative Hazard Intensity score. Falls back to Green (the
    safest/default) if the footprint doesn't intersect any supplied zone
    geometry at all."""
    total_area = footprint.area
    if total_area <= 0:
        return "Green"
    best_class, best_fraction = "Green", 0.0
    for zone_class, geometry in zone_geoms_by_class.items():
        if geometry is None or geometry.is_empty:
            continue
        fraction = footprint.intersection(geometry).area / total_area
        if fraction > best_fraction:
            best_class, best_fraction = zone_class, fraction
    return best_class


def assess_habitation(
    habitation_id: str,
    lon: float,
    lat: float,
    households: int,
    habitation_attributes: dict,
    hazard_zone_geoms: dict[str, dict[str, BaseGeometry]],
    hazard_zone_scores: dict[str, dict[str, float]],
) -> AssessmentResult:
    """`hazard_zone_geoms`/`hazard_zone_scores` are both keyed hazardType ->
    zoneClass -> value (geometry / that class's representative
    hazardScore) — one entry per hazard the habitation's district is
    exposed to."""
    footprint = habitation_footprint(lon, lat, households)
    vresult = compute_vulnerability(habitation_attributes)

    hazard_exposure: list[HazardExposureResult] = []
    zone_class_by_hazard: dict[str, str] = {}
    risk_by_hazard: dict[str, float] = {}

    for hazard_type, zone_geoms in hazard_zone_geoms.items():
        dominant_class = _dominant_zone_class(footprint, zone_geoms)
        hazard_score = hazard_zone_scores.get(hazard_type, {}).get(dominant_class, 0.0)
        exposure = compute_exposure(footprint, zone_geoms)
        risk = compute_risk(hazard_score, exposure, vresult.vi, vresult.coping_capacity)

        zone_class_by_hazard[hazard_type] = dominant_class
        risk_by_hazard[hazard_type] = risk
        hazard_exposure.append(
            HazardExposureResult(
                hazard_type=hazard_type,
                hazard_score=hazard_score,
                exposure=exposure,
                zone_class=dominant_class,
            )
        )

    governing = governing_risk(risk_by_hazard)
    overall_zone_class = aggregate_multi_hazard(zone_class_by_hazard)

    relocation_priority_index: float | None = None
    priority_bucket: str | None = None
    explanation: list[dict] = []
    if overall_zone_class in ("Red", "Orange"):
        relocation_priority_index = compute_rpi(governing.risk, vresult.vi)
        priority_bucket = bucket_for_rpi(relocation_priority_index)
        explanation = rpi_contributions(governing.risk, vresult.normalized_indicators, top_n=5)

    return AssessmentResult(
        habitation_id=habitation_id,
        hazard_exposure=hazard_exposure,
        vulnerability_index=vresult.vi,
        vulnerability_dimensions=vresult.dimension_scores,
        coping_capacity=vresult.coping_capacity,
        composite_risk_score=governing.risk,
        governing_hazard=governing.hazard_type,
        overall_zone_class=overall_zone_class,
        relocation_priority_index=relocation_priority_index,
        priority_bucket=priority_bucket,
        explanation=explanation,
    )
