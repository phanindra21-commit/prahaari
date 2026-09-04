"""Orchestrates the weighted-overlay + ML scoring pipeline for one hazard.

`score_cells()` is the request-driven core: given raw cell data (h3Index,
lon, lat, factors) and real event points, it runs overlay -> labels ->
train -> blend and returns per-cell scores plus training metrics. It has
no file-system dependency, so `app/routes/zoning.py`'s live FastAPI route
calls it directly with data POSTed by apps/api's job worker (services/ml
stays stateless per docs/ARCHITECTURE.md).

`score_hazard()` is a thin file-based wrapper around the same core, reading
from data/processed/ (services/ml/scripts/derive_factors.py's output) and
data/seed/ — used by the offline status-check scripts
(run_scoring_pipeline.py, run_zoning_pipeline.py) for local dev/demo
without needing a live apps/api + MongoDB round trip.

Neither path duplicates the scoring logic — both call `score_cells()`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

import numpy as np

from app.config_loader import HAZARD_WEIGHTS
from app.engine.blend import blended_score
from app.engine.explain import top_contributions_batch
from app.engine.labels import generate_labels
from app.engine.overlay import overlay_score
from app.engine.train import TrainedModel, train_hazard_model

DATA_DIR = Path(__file__).resolve().parents[4] / "data"
PROCESSED_DIR = DATA_DIR / "processed"
SEED_DIR = DATA_DIR / "seed"


def _slug(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def _load_districts() -> list[dict]:
    return json.loads((SEED_DIR / "districts.json").read_text(encoding="utf-8"))


def districts_for_hazard(hazard: str) -> list[str]:
    """District slugs (data/processed/<slug>-*.json) whose primaryHazards include `hazard`."""
    return [_slug(d["name"]) for d in _load_districts() if hazard in d["primaryHazards"]]


def _event_points_for(hazard: str, slugs: list[str]) -> list[tuple[float, float]]:
    slug_to_lgd = {_slug(d["name"]): d["lgdCode"] for d in _load_districts()}
    lgd_codes = {slug_to_lgd[s] for s in slugs}
    events = json.loads((SEED_DIR / "hazard-events.json").read_text(encoding="utf-8"))
    return [
        tuple(e["extent"]["coordinates"])
        for e in events
        if e["hazardType"] == hazard
        and e["districtLgdCode"] in lgd_codes
        and e["extent"]["type"] == "Point"
    ]


class HazardScoring(NamedTuple):
    h3_indexes: list[str]
    districts: list[str]
    lons: np.ndarray
    lats: np.ndarray
    overlay_scores: np.ndarray
    ml_scores: np.ndarray
    blended_scores: np.ndarray
    feature_list: list[str]
    trained: TrainedModel
    label_source: str
    labelled_count: int
    top_factors: list[list[dict]]


class CellInput(NamedTuple):
    h3_index: str
    district: str
    lon: float
    lat: float
    factors: dict[str, float]


def score_cells(
    hazard: str,
    cells: list[CellInput],
    event_points: list[tuple[float, float]] | None = None,
) -> HazardScoring:
    """The request-driven scoring core — no file-system access. `cells` must
    all carry factor values for `hazard` (the caller filters)."""
    if not cells:
        raise ValueError(f"score_cells called with zero cells for hazard '{hazard}'")

    feature_list = sorted(HAZARD_WEIGHTS["hazards"][hazard]["factors"].keys())

    h3_indexes = [c.h3_index for c in cells]
    districts = [c.district for c in cells]
    lons_arr = np.array([c.lon for c in cells])
    lats_arr = np.array([c.lat for c in cells])
    overlay_scores = np.array([overlay_score(c.factors, hazard) for c in cells])
    features = np.array([[c.factors[f] for f in feature_list] for c in cells])

    labels, label_source = generate_labels(lons_arr, lats_arr, [c.factors for c in cells], hazard, event_points)

    trained = train_hazard_model(features, feature_list, labels, h3_indexes)

    ml_scores = trained.model.predict_proba(features)[:, 1]
    blended = np.array([blended_score(o, m, hazard) for o, m in zip(overlay_scores, ml_scores)])

    # explain.py caches the SHAP explainer by the model OBJECT itself (a
    # weak reference), not a derived string key — a fresh model is trained
    # on every score_cells() call, so this always builds/reuses the right
    # explainer for THIS model, and the batch call below still builds it
    # once for every cell in this run, not once per cell.
    top_factors = top_contributions_batch(trained.model, features, feature_list)

    return HazardScoring(
        h3_indexes=h3_indexes,
        districts=districts,
        lons=lons_arr,
        lats=lats_arr,
        overlay_scores=overlay_scores,
        ml_scores=ml_scores,
        blended_scores=blended,
        feature_list=feature_list,
        trained=trained,
        label_source=label_source,
        labelled_count=len(h3_indexes),
        top_factors=top_factors,
    )


def score_hazard(hazard: str) -> HazardScoring:
    """File-based convenience wrapper for local dev/demo — see the module docstring."""
    slugs = districts_for_hazard(hazard)
    if not slugs:
        raise ValueError(
            f"No district in data/seed/districts.json lists '{hazard}' as a primary hazard"
        )

    cells: list[CellInput] = []
    for slug in slugs:
        grid_path = PROCESSED_DIR / f"{slug}-grid.json"
        factors_path = PROCESSED_DIR / f"{slug}-factors.json"
        if not grid_path.exists() or not factors_path.exists():
            raise FileNotFoundError(
                f"[pipeline] {grid_path} / {factors_path} not found — run "
                "`npm run generate-grid` (apps/api) then `python scripts/derive_factors.py` first."
            )
        grid = json.loads(grid_path.read_text(encoding="utf-8"))
        factors_by_cell = json.loads(factors_path.read_text(encoding="utf-8"))
        for row in grid:
            h3_index = row["h3Index"]
            cell_factors = factors_by_cell.get(h3_index, {}).get(hazard)
            if cell_factors is None:
                continue
            cells.append(CellInput(h3_index, slug, row["lon"], row["lat"], cell_factors))

    event_points = _event_points_for(hazard, slugs)
    return score_cells(hazard, cells, event_points)
