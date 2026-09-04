"""Orchestrates a BATCH of habitations' full assessment: hazard exposure,
VI + CopingCapacity, Risk + the governing (worst) hazard — then, only for
habitations whose OVERALL zone class (METHODOLOGY §1.3's multi-hazard
aggregation, zones.py::aggregate_multi_hazard) is Red or Orange, RPI +
priority bucket + a top-5 signed contribution breakdown.

RPI needs the whole batch, not just one habitation: `normalize(Risk)`
(METHODOLOGY §3) is a min-max rescaling of each habitation's Risk against
the OTHER Red/Orange habitations assessed in the same run — see
priority.py's module docstring for why a per-habitation no-op reading of
"normalize" was a structural bug (RPI could never exceed VI, so no
habitation could ever reach Immediate regardless of hazard severity).
That's why this module assesses a batch, in two passes, rather than one
habitation at a time.

Pure functions: no MongoDB, no FastAPI — `app/routes/assessment.py` is the
thin request/response wrapper; `apps/api`'s job worker supplies every
input (habitation attributes, dissolved zone geometry, per-zone-class
hazard scores) so services/ml never touches persistence, per
docs/ARCHITECTURE.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shapely.geometry.base import BaseGeometry

from app.engine.priority import bucket_for_rpi, compute_rpi, normalize_risk, rpi_contributions
from app.engine.risk import compute_exposure, compute_risk, governing_risk, habitation_footprint
from app.engine.vulnerability import compute_vulnerability
from app.engine.zones import aggregate_multi_hazard

RPI_ELIGIBLE_ZONE_CLASSES = ("Red", "Orange")


@dataclass
class HabitationInput:
    habitation_id: str
    lon: float
    lat: float
    households: int
    attributes: dict


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
    relocation_priority_index: float | None = None
    priority_bucket: str | None = None
    explanation: list[dict] = field(default_factory=list)


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


def assess_habitations_batch(
    habitations: list[HabitationInput],
    hazard_zone_geoms: dict[str, dict[str, BaseGeometry]],
    hazard_zone_scores: dict[str, dict[str, float]],
) -> list[AssessmentResult]:
    """`hazard_zone_geoms`/`hazard_zone_scores` are both keyed hazardType ->
    zoneClass -> value (geometry / that class's representative hazardScore)
    — shared by every habitation in the batch (they're all in the same
    district/run). Pass 1 computes VI, exposure, and raw Risk per
    habitation; pass 2 min-max normalizes Risk across the Red/Orange
    subset and computes RPI/bucket/explanation for just that subset."""
    results: list[AssessmentResult] = []
    normalized_indicators_by_id: dict[str, dict[str, float]] = {}

    for habitation in habitations:
        footprint = habitation_footprint(habitation.lon, habitation.lat, habitation.households)
        vresult = compute_vulnerability(habitation.attributes)
        normalized_indicators_by_id[habitation.habitation_id] = vresult.normalized_indicators

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

        results.append(
            AssessmentResult(
                habitation_id=habitation.habitation_id,
                hazard_exposure=hazard_exposure,
                vulnerability_index=vresult.vi,
                vulnerability_dimensions=vresult.dimension_scores,
                coping_capacity=vresult.coping_capacity,
                composite_risk_score=governing.risk,
                governing_hazard=governing.hazard_type,
                overall_zone_class=overall_zone_class,
            )
        )

    eligible = [r for r in results if r.overall_zone_class in RPI_ELIGIBLE_ZONE_CLASSES]
    if eligible:
        min_risk = min(r.composite_risk_score for r in eligible)
        max_risk = max(r.composite_risk_score for r in eligible)
        for result in eligible:
            normalized = normalize_risk(result.composite_risk_score, min_risk, max_risk)
            result.relocation_priority_index = compute_rpi(normalized, result.vulnerability_index)
            result.priority_bucket = bucket_for_rpi(result.relocation_priority_index)
            result.explanation = rpi_contributions(
                normalized, normalized_indicators_by_id[result.habitation_id], top_n=5
            )

    return results
