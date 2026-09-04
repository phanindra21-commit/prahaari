"""Step 8 Part 2 — the scenario simulator's engine core.

Applies a parameterized what-if perturbation (rainfall, sea-level rise,
cyclone category) to a hazard's causative factors and re-runs
overlay -> ML -> blend -> classify, then diffs the result against a
baseline computed from the SAME real (unperturbed) factors and the SAME
trained model, in one call. `run_district_scenario()` is the top-level
orchestrator apps/api's scenario route calls; nothing here writes to
Mongo or the filesystem — apps/api persists the returned result onto a
ScenarioRun document only. The district's active HazardZone/Assessment
documents are never touched (see CLAUDE.md's human-in-the-loop
principle: a scenario is advisory and hypothetical until an officer acts
on it through the real pipeline).

Performance (Step 8 Part 2C — "reuse the trained models rather than
retraining"): `pipeline.score_cells()` trains a fresh XGBoost model on
every call — the single most expensive step in the whole pipeline (fit +
SHAP TreeExplainer construction). This module calls it EXACTLY ONCE per
(district, hazard) — the baseline pass — and reuses that same fitted
`trained.model.predict_proba()` on the perturbed feature matrix for the
"scenario" pass. A hazard the scenario's parameters don't touch (e.g.
cloudburst when only rainfall is simulated) skips the second pass
entirely and reuses its baseline scores for both "baseline" and
"scenario" display — see `is_hazard_affected()`.

Known, documented simplification vs. the live zoning pipeline: the live
pipeline pools grid cells ACROSS every district that shares a hazard as
a primary hazard before training (apps/api's zoningJob.ts), so its model
sees more training examples. This module trains on the ONE requested
district's cells only, to keep a scenario run self-contained and fast
(no need to fetch every other district's grid for a single-district
what-if). The resulting zone classifications will not be bit-identical
to a live zoning run's — expected and acceptable for an advisory,
non-persisted simulation, not a bug.

The parameter -> factor mapping is entirely data
(packages/shared/src/config/scenario-parameters.json, loaded as
SCENARIO_PARAMETERS) — this module must never hardcode a rainfall-mm /
sea-level-m / cyclone-category -> factor-delta formula itself.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
from shapely.geometry.base import BaseGeometry

from app.config_loader import SCENARIO_PARAMETERS
from app.engine.assessment import AssessmentResult, HabitationInput, assess_habitations_batch
from app.engine.blend import blended_score
from app.engine.disaster_history import HazardEventPoint
from app.engine.overlay import overlay_score
from app.engine.pipeline import CellInput, HazardScoring, score_cells
from app.engine.zones import ZONE_ORDER, classify_zone, dissolve_zone_class

ZONE_CLASSES = ("Red", "Orange", "Yellow", "Green")


@dataclass
class ScenarioParams:
    rainfall_mm_per_24h: float | None = None
    sea_level_rise_m: float | None = None
    cyclone_category: int | None = None

    def is_empty(self) -> bool:
        return self.rainfall_mm_per_24h is None and self.sea_level_rise_m is None and self.cyclone_category is None


def _clip01(value: float) -> float:
    return float(np.clip(value, 0.0, 1.0))


def is_hazard_affected(hazard: str, params: ScenarioParams) -> bool:
    """Whether any configured scenario-parameters.json rule for this
    hazard would actually fire for the given params — lets the caller
    skip a redundant second (scenario) scoring pass for a hazard the
    scenario doesn't touch."""
    if params.rainfall_mm_per_24h is not None and any(
        r["hazard"] == hazard for r in SCENARIO_PARAMETERS["rainfall"]["affects"]
    ):
        return True
    if params.sea_level_rise_m is not None and any(
        r["hazard"] == hazard for r in SCENARIO_PARAMETERS["seaLevelRise"]["affects"]
    ):
        return True
    if params.cyclone_category is not None and any(
        r["hazard"] == hazard for r in SCENARIO_PARAMETERS["cyclone"]["affects"]
    ):
        return True
    return False


def perturb_factors(factors: dict[str, float], hazard: str, params: ScenarioParams) -> dict[str, float]:
    """Returns a NEW factors dict with every applicable scenario-parameters.json
    rule applied — never mutates `factors`."""
    result = dict(factors)

    if params.rainfall_mm_per_24h is not None:
        cfg = SCENARIO_PARAMETERS["rainfall"]
        ratio = params.rainfall_mm_per_24h / cfg["baselineMmPer24h"]
        for rule in cfg["affects"]:
            if rule["hazard"] != hazard or rule["factor"] not in result:
                continue
            result[rule["factor"]] = _clip01(result[rule["factor"]] + (ratio - 1.0) * rule["sensitivity"])

    if params.sea_level_rise_m is not None:
        cfg = SCENARIO_PARAMETERS["seaLevelRise"]
        for rule in cfg["affects"]:
            if rule["hazard"] != hazard or rule["factor"] not in result:
                continue
            if rule["mode"] == "SUBTRACT_METERS":
                result[rule["factor"]] = max(0.0, result[rule["factor"]] - params.sea_level_rise_m * rule["sensitivity"])
            else:  # ADD_INDEX
                result[rule["factor"]] = _clip01(result[rule["factor"]] + params.sea_level_rise_m * rule["sensitivity"])

    if params.cyclone_category is not None:
        cfg = SCENARIO_PARAMETERS["cyclone"]
        deltas = cfg["categories"][str(params.cyclone_category)]
        for rule in cfg["affects"]:
            if rule["hazard"] != hazard or rule["factor"] not in result:
                continue
            result[rule["factor"]] = _clip01(result[rule["factor"]] + deltas[rule["deltaKey"]])

    return result


@dataclass
class ScenarioCellResult:
    h3_index: str
    district: str
    baseline_blended: float
    baseline_zone_class: str
    scenario_blended: float
    scenario_zone_class: str


@dataclass
class ScenarioHazardResult:
    hazard: str
    affected: bool
    cells: list[ScenarioCellResult]


def run_scenario_for_hazard(
    hazard: str,
    cells: list[CellInput],
    event_points: list[tuple[float, float]],
    params: ScenarioParams,
) -> ScenarioHazardResult:
    """The ONE training pass for this hazard (`score_cells`) — baseline
    scores come straight from it; the scenario pass, if this hazard is
    affected, reuses `baseline.trained.model` for prediction only, never
    retraining."""
    baseline: HazardScoring = score_cells(hazard, cells, event_points)

    affected = is_hazard_affected(hazard, params)
    if not affected:
        scenario_blended = baseline.blended_scores
    else:
        perturbed_cells = [
            CellInput(c.h3_index, c.district, c.lon, c.lat, perturb_factors(c.factors, hazard, params))
            for c in cells
        ]
        perturbed_features = np.array(
            [[c.factors[f] for f in baseline.feature_list] for c in perturbed_cells]
        )
        perturbed_overlay = np.array([overlay_score(c.factors, hazard) for c in perturbed_cells])
        perturbed_ml = baseline.trained.model.predict_proba(perturbed_features)[:, 1]
        scenario_blended = np.array(
            [blended_score(float(o), float(m), hazard) for o, m in zip(perturbed_overlay, perturbed_ml)]
        )

    cells_out = [
        ScenarioCellResult(
            h3_index=h3_index,
            district=district,
            baseline_blended=float(b),
            baseline_zone_class=classify_zone(float(b), hazard),
            scenario_blended=float(s),
            scenario_zone_class=classify_zone(float(s), hazard),
        )
        for h3_index, district, b, s in zip(
            baseline.h3_indexes, baseline.districts, baseline.blended_scores, scenario_blended
        )
    ]
    return ScenarioHazardResult(hazard=hazard, affected=affected, cells=cells_out)


def _zone_geoms_and_scores(
    cell_results: list[ScenarioCellResult], use_scenario: bool
) -> tuple[dict[str, BaseGeometry], dict[str, float]]:
    """Dissolves one hazard's cells into per-zone-class geometry, plus
    each class's mean blended score — the exact shape
    `assessment.assess_habitations_batch` expects (mirrors
    assessmentStage.ts's TypeScript mean-aggregation, done here in Python
    since scenario.py owns the whole district-level orchestration for a
    scenario run, not split across a process boundary)."""
    h3_by_class: dict[str, list[str]] = {}
    score_sum_by_class: dict[str, float] = {}
    for c in cell_results:
        zone_class = c.scenario_zone_class if use_scenario else c.baseline_zone_class
        score = c.scenario_blended if use_scenario else c.baseline_blended
        h3_by_class.setdefault(zone_class, []).append(c.h3_index)
        score_sum_by_class[zone_class] = score_sum_by_class.get(zone_class, 0.0) + score

    geoms: dict[str, BaseGeometry] = {}
    scores: dict[str, float] = {}
    for zone_class, h3_indexes in h3_by_class.items():
        full, _simplified = dissolve_zone_class(h3_indexes)
        geoms[zone_class] = full
        scores[zone_class] = score_sum_by_class[zone_class] / len(h3_indexes)
    return geoms, scores


@dataclass
class HazardCellSummary:
    hazard: str
    affected: bool
    baseline_zone_counts: dict[str, int]
    scenario_zone_counts: dict[str, int]
    cells_changed: int
    newly_red_cells: int


@dataclass
class CellClassTransition:
    hazard: str
    from_class: str
    to_class: str
    cell_count: int


@dataclass
class HabitationDelta:
    habitation_id: str
    baseline_overall_zone_class: str
    scenario_overall_zone_class: str
    baseline_priority_bucket: str | None
    scenario_priority_bucket: str | None
    entered_immediate: bool
    zone_class_worsened: bool


@dataclass
class HazardZoneGeometries:
    hazard: str
    baseline: dict[str, BaseGeometry]  # zoneClass -> dissolved geometry
    scenario: dict[str, BaseGeometry]
    changed: BaseGeometry | None  # dissolved geometry of every cell whose class changed, or None if none did


@dataclass
class DistrictScenarioResult:
    hazard_summaries: list[HazardCellSummary]
    cell_transitions: list[CellClassTransition]
    habitation_deltas: list[HabitationDelta]
    habitations_entering_immediate: list[str]
    runtime_seconds: float
    baseline_assessments: list[AssessmentResult] = field(default_factory=list)
    scenario_assessments: list[AssessmentResult] = field(default_factory=list)
    zone_geometries: list[HazardZoneGeometries] = field(default_factory=list)


def run_district_scenario(
    hazard_cells: dict[str, list[CellInput]],
    hazard_event_points: dict[str, list[tuple[float, float]]],
    habitations: list[HabitationInput],
    hazard_events: list[HazardEventPoint],
    params: ScenarioParams,
    as_of: datetime,
) -> DistrictScenarioResult:
    """`hazard_cells` must include EVERY hazard the district's habitations
    are assessed against (not just the ones `params` perturbs) — a
    habitation's overall zone class/priority bucket depends on the worst
    class across ALL its hazards (zones.aggregate_multi_hazard), so an
    unaffected hazard still needs its baseline computed once to feed both
    the baseline and scenario assessment passes identically."""
    started = time.monotonic()

    hazard_results: dict[str, ScenarioHazardResult] = {
        hazard: run_scenario_for_hazard(hazard, cells, hazard_event_points.get(hazard, []), params)
        for hazard, cells in hazard_cells.items()
    }

    baseline_geoms: dict[str, dict[str, BaseGeometry]] = {}
    baseline_scores: dict[str, dict[str, float]] = {}
    scenario_geoms: dict[str, dict[str, BaseGeometry]] = {}
    scenario_scores: dict[str, dict[str, float]] = {}
    hazard_summaries: list[HazardCellSummary] = []
    cell_transitions: list[CellClassTransition] = []
    zone_geometries: list[HazardZoneGeometries] = []

    for hazard, result in hazard_results.items():
        b_geoms, b_scores = _zone_geoms_and_scores(result.cells, use_scenario=False)
        baseline_geoms[hazard], baseline_scores[hazard] = b_geoms, b_scores
        if result.affected:
            s_geoms, s_scores = _zone_geoms_and_scores(result.cells, use_scenario=True)
        else:
            s_geoms, s_scores = b_geoms, b_scores
        scenario_geoms[hazard], scenario_scores[hazard] = s_geoms, s_scores

        baseline_counts = dict.fromkeys(ZONE_CLASSES, 0)
        scenario_counts = dict.fromkeys(ZONE_CLASSES, 0)
        transition_counts: dict[tuple[str, str], int] = {}
        cells_changed = 0
        newly_red = 0
        for c in result.cells:
            baseline_counts[c.baseline_zone_class] += 1
            scenario_counts[c.scenario_zone_class] += 1
            if c.baseline_zone_class != c.scenario_zone_class:
                cells_changed += 1
                key = (c.baseline_zone_class, c.scenario_zone_class)
                transition_counts[key] = transition_counts.get(key, 0) + 1
                if c.scenario_zone_class == "Red" and c.baseline_zone_class != "Red":
                    newly_red += 1

        hazard_summaries.append(
            HazardCellSummary(
                hazard=hazard,
                affected=result.affected,
                baseline_zone_counts=baseline_counts,
                scenario_zone_counts=scenario_counts,
                cells_changed=cells_changed,
                newly_red_cells=newly_red,
            )
        )
        for (from_class, to_class), count in transition_counts.items():
            cell_transitions.append(
                CellClassTransition(hazard=hazard, from_class=from_class, to_class=to_class, cell_count=count)
            )

        changed_h3_indexes = [c.h3_index for c in result.cells if c.baseline_zone_class != c.scenario_zone_class]
        changed_geom = dissolve_zone_class(changed_h3_indexes)[0] if changed_h3_indexes else None
        zone_geometries.append(
            HazardZoneGeometries(hazard=hazard, baseline=b_geoms, scenario=s_geoms, changed=changed_geom)
        )

    baseline_assessments = assess_habitations_batch(habitations, baseline_geoms, baseline_scores, hazard_events, as_of)
    scenario_assessments = assess_habitations_batch(habitations, scenario_geoms, scenario_scores, hazard_events, as_of)

    baseline_by_id = {a.habitation_id: a for a in baseline_assessments}
    habitation_deltas: list[HabitationDelta] = []
    entering_immediate: list[str] = []
    for scenario_a in scenario_assessments:
        baseline_a = baseline_by_id[scenario_a.habitation_id]
        zone_changed = baseline_a.overall_zone_class != scenario_a.overall_zone_class
        bucket_changed = baseline_a.priority_bucket != scenario_a.priority_bucket
        if not zone_changed and not bucket_changed:
            continue
        entered_immediate = scenario_a.priority_bucket == "Immediate" and baseline_a.priority_bucket != "Immediate"
        if entered_immediate:
            entering_immediate.append(scenario_a.habitation_id)
        habitation_deltas.append(
            HabitationDelta(
                habitation_id=scenario_a.habitation_id,
                baseline_overall_zone_class=baseline_a.overall_zone_class,
                scenario_overall_zone_class=scenario_a.overall_zone_class,
                baseline_priority_bucket=baseline_a.priority_bucket,
                scenario_priority_bucket=scenario_a.priority_bucket,
                entered_immediate=entered_immediate,
                zone_class_worsened=ZONE_ORDER[scenario_a.overall_zone_class] > ZONE_ORDER[baseline_a.overall_zone_class],
            )
        )

    return DistrictScenarioResult(
        hazard_summaries=hazard_summaries,
        cell_transitions=cell_transitions,
        habitation_deltas=habitation_deltas,
        habitations_entering_immediate=entering_immediate,
        runtime_seconds=time.monotonic() - started,
        baseline_assessments=baseline_assessments,
        scenario_assessments=scenario_assessments,
        zone_geometries=zone_geometries,
    )
