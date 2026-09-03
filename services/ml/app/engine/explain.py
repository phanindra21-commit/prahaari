"""SHAP-based explanations for the trained susceptibility models.

Top-N signed factor contributions per prediction, cached per model version
so the (comparatively expensive) SHAP explainer is built once per model,
not rebuilt on every cell/habitation prediction.
"""

from __future__ import annotations

import numpy as np
import shap
import xgboost as xgb

_explainer_cache: dict[str, shap.TreeExplainer] = {}


def get_explainer(model: xgb.XGBClassifier, model_version: str) -> shap.TreeExplainer:
    if model_version not in _explainer_cache:
        _explainer_cache[model_version] = shap.TreeExplainer(model)
    return _explainer_cache[model_version]


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
    model_version: str,
    x: np.ndarray,
    feature_list: list[str],
    top_n: int = 5,
) -> list[list[dict]]:
    """Top-N signed factor contributions for EVERY row in `x`, computed with
    a single `shap_values` call on the whole batch — one explainer build,
    one batched SHAP pass, not N single-row calls. This is what
    app/engine/pipeline.py's score_cells() uses to attach an explanation to
    every cell in one zoning run."""
    explainer = get_explainer(model, model_version)
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
    model_version: str,
    x_row: np.ndarray,
    feature_list: list[str],
    top_n: int = 5,
) -> list[dict]:
    """Up to `top_n` factor contributions for one cell/habitation's
    prediction, sorted by |contribution| descending, each tagged with a
    direction (INCREASES_RISK / DECREASES_RISK)."""
    return top_contributions_batch(model, model_version, x_row.reshape(1, -1), feature_list, top_n)[0]
