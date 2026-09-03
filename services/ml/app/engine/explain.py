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


def _positive_class_row(shap_values: object) -> np.ndarray:
    """Normalizes the several shapes shap.TreeExplainer.shap_values can
    return for a binary classifier's single-row prediction into a flat
    per-feature array for the positive class."""
    if isinstance(shap_values, list):
        # Older SHAP: [negative_class_array, positive_class_array], each (n_samples, n_features).
        return np.asarray(shap_values[-1])[0]
    arr = np.asarray(shap_values)
    if arr.ndim == 3:
        # Newer SHAP: (n_samples, n_features, n_classes).
        return arr[0, :, -1]
    return arr[0]


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
    explainer = get_explainer(model, model_version)
    raw = explainer.shap_values(x_row.reshape(1, -1))
    values = _positive_class_row(raw)

    contributions = [
        {
            "factor": feature_list[i],
            "contribution": float(values[i]),
            "direction": "INCREASES_RISK" if values[i] > 0 else "DECREASES_RISK",
        }
        for i in range(len(feature_list))
    ]
    contributions.sort(key=lambda c: abs(c["contribution"]), reverse=True)
    return contributions[:top_n]
