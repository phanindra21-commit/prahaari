"""Orchestrates the weighted-overlay + ML scoring pipeline for one hazard,
across every district exposed to it, from the factor values
services/ml/scripts/derive_factors.py wrote to data/processed/.

Reusable — the Commit 2 status-check script (run_scoring_pipeline.py),
Commit 3's zoning/dissolve script, and Commit 4's FastAPI route all call
`score_hazard()` rather than duplicating this logic.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

import numpy as np

from app.config_loader import HAZARD_WEIGHTS
from app.engine.blend import blended_score
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


def score_hazard(hazard: str) -> HazardScoring:
    slugs = districts_for_hazard(hazard)
    if not slugs:
        raise ValueError(
            f"No district in data/seed/districts.json lists '{hazard}' as a primary hazard"
        )

    h3_indexes: list[str] = []
    districts: list[str] = []
    lons: list[float] = []
    lats: list[float] = []
    factor_rows: list[dict[str, float]] = []

    feature_list = sorted(HAZARD_WEIGHTS["hazards"][hazard]["factors"].keys())

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
            h3_indexes.append(h3_index)
            districts.append(slug)
            lons.append(row["lon"])
            lats.append(row["lat"])
            factor_rows.append(cell_factors)

    lons_arr = np.array(lons)
    lats_arr = np.array(lats)
    overlay_scores = np.array([overlay_score(row, hazard) for row in factor_rows])
    features = np.array([[row[f] for f in feature_list] for row in factor_rows])

    event_points = _event_points_for(hazard, slugs)
    labels, label_source = generate_labels(lons_arr, lats_arr, overlay_scores, event_points)

    labelled_mask = labels != -1
    labelled_h3 = [h3_indexes[i] for i in range(len(h3_indexes)) if labelled_mask[i]]
    trained = train_hazard_model(
        features[labelled_mask],
        feature_list,
        labels[labelled_mask],
        labelled_h3,
    )

    ml_scores = trained.model.predict_proba(features)[:, 1]
    blended = np.array(
        [blended_score(o, m) for o, m in zip(overlay_scores, ml_scores)]
    )

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
        labelled_count=int(labelled_mask.sum()),
    )
