"""SHAP-based explanations for the trained susceptibility models.

Top-N signed factor contributions per prediction, cached per model OBJECT
so the (comparatively expensive) SHAP explainer is built once per model,
not rebuilt on every cell/habitation prediction.

Cache key is the model object itself, held with a WEAK reference — never
a caller-supplied string. An earlier version keyed this cache on
`f"run-{id(trained.model)}"` (pipeline.py, a fresh model trained on every
score_cells() call). `id()` is a memory address, and CPython is free to
reuse a freed object's address for a new, unrelated object — which is
exactly what happens when several models are trained back-to-back in one
process (e.g. scenario.py's run_district_scenario(), which trains one
model per hazard in a single request): a garbage-collected landslide
model's id() could be reassigned to a newly-trained flood model, and the
cache would silently hand back the LANDSLIDE explainer (wrong feature
count) for a flood prediction — surfaced as an opaque XGBoost shape
assertion deep inside shap_values(), not a clear error at the call site.
A WeakKeyDictionary makes a stale hit structurally impossible (a cache
key can only match a still-live model with that exact identity) and
evicts automatically once a model is garbage collected, so this cache
cannot leak across the life of a long-running FastAPI process either.
"""

from __future__ import annotations

import weakref

import numpy as np
import shap
import xgboost as xgb

_explainer_cache: "weakref.WeakKeyDictionary[xgb.XGBClassifier, shap.TreeExplainer]" = weakref.WeakKeyDictionary()


def get_explainer(model: xgb.XGBClassifier) -> shap.TreeExplainer:
    if model not in _explainer_cache:
        _explainer_cache[model] = shap.TreeExplainer(model)
    return _explainer_cache[model]


def _positive_class_matrix(shap_values: object) -> np.ndarray:
    """Same normalization as `_positive_class_row`, for a full (n_samples,
    n_features) batch rather than one row."""
    if isinstance(shap_values, list):
        return np.asarray(shap_values[-1])
    arr = np.asarray(shap_values)
    if arr.ndim == 3:
        return arr[:, :, -1]
    return arr


def top_contributions_batch(
    model: xgb.XGBClassifier,
    x: np.ndarray,
    feature_list: list[str],
    top_n: int = 5,
) -> list[list[dict]]:
    """Top-N signed factor contributions for EVERY row in `x`, computed with
    a single `shap_values` call on the whole batch — one explainer build,
    one batched SHAP pass, not N single-row calls. This is what
    app/engine/pipeline.py's score_cells() uses to attach an explanation to
    every cell in one zoning run."""
    explainer = get_explainer(model)
    raw = explainer.shap_values(x)
    values = _positive_class_matrix(raw)

    results: list[list[dict]] = []
    for row in values:
        contributions = [
            {
                "factor": feature_list[i],
                "contribution": float(row[i]),
                "direction": "INCREASES_RISK" if row[i] > 0 else "DECREASES_RISK",
            }
            for i in range(len(feature_list))
        ]
        contributions.sort(key=lambda c: abs(c["contribution"]), reverse=True)
        results.append(contributions[:top_n])
    return results


def top_contributions(
    model: xgb.XGBClassifier,
    x_row: np.ndarray,
    feature_list: list[str],
    top_n: int = 5,
) -> list[dict]:
    """Up to `top_n` factor contributions for one cell/habitation's
    prediction, sorted by |contribution| descending, each tagged with a
    direction (INCREASES_RISK / DECREASES_RISK)."""
    return top_contributions_batch(model, x_row.reshape(1, -1), feature_list, top_n)[0]
