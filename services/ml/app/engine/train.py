"""Trains a per-hazard XGBoost binary susceptibility classifier on
SYNTHETIC_DEMO labels (labels.py). Uses a SPATIAL block/checkerboard split
by H3 parent cell — never a random row-wise split — because adjacent grid
cells share nearly all of their causative-factor signal by construction
(overlay.py's inputs are deliberately spatially coherent, see
derive_factors.py): a random split would put near-duplicate neighboring
cells on both sides of train/test, inflating every reported metric via
spatial autocorrelation leakage. See docs/ZONING_PIPELINE.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import h3
import numpy as np
import xgboost as xgb
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score


@dataclass
class TrainedModel:
    model: xgb.XGBClassifier
    feature_list: list[str]
    metrics: dict[str, float]
    training_sample_count: int
    # [[TN, FP], [FN, TP]] on the held-out spatial test split.
    confusion_matrix: list[list[int]]


def spatial_block_split(h3_indexes: list[str], parent_resolution: int = 5) -> np.ndarray:
    """Returns a boolean array, True = test split. Cells are assigned to
    train/test by their H3 PARENT cell at `parent_resolution` (coarser than
    the grid's own resolution 8), split on the parent index's rank parity —
    a checkerboard over contiguous spatial blocks, not individual cells, so
    no parent block straddles both sets."""
    parents = [h3.cell_to_parent(h, parent_resolution) for h in h3_indexes]
    unique_parents = sorted(set(parents))
    parent_is_test = {p: (i % 2 == 1) for i, p in enumerate(unique_parents)}
    return np.array([parent_is_test[p] for p in parents])


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
    """Bin-weighted mean |predicted probability - observed positive rate|
    across equal-width probability bins — a standard calibration metric."""
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (y_prob >= lo) & (y_prob <= hi if hi == 1 else y_prob < hi)
        if not np.any(mask):
            continue
        bin_confidence = float(np.mean(y_prob[mask]))
        bin_accuracy = float(np.mean(y_true[mask]))
        ece += (np.sum(mask) / len(y_true)) * abs(bin_confidence - bin_accuracy)
    return ece


def train_hazard_model(
    features: np.ndarray,
    feature_list: list[str],
    labels: np.ndarray,
    h3_indexes: list[str],
    *,
    parent_resolution: int = 5,
    seed: int = 42,
) -> TrainedModel:
    """`features` is (n_samples, n_features) aligned with `feature_list` and
    `labels` (0/1 only — filter out unlabelled/-1 rows before calling)."""
    test_mask = spatial_block_split(h3_indexes, parent_resolution)
    x_train, x_test = features[~test_mask], features[test_mask]
    y_train, y_test = labels[~test_mask], labels[test_mask]

    if len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
        raise ValueError(
            "spatial block split produced a train or test split with only one class present — "
            "adjust labels.py's target_base_rate or use a finer parent_resolution"
        )

    # Hazard events are rare by design now (labels.py's target_base_rate ~
    # 10-20%) — scale_pos_weight keeps the model from just always predicting
    # the majority class, which would otherwise crater recall/F1 on the
    # minority (positive) class while AUC-ROC looked fine.
    positive_count = int(np.sum(y_train == 1))
    negative_count = int(np.sum(y_train == 0))
    scale_pos_weight = negative_count / max(positive_count, 1)

    model = xgb.XGBClassifier(
        max_depth=4,
        n_estimators=200,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        eval_metric="logloss",
        scale_pos_weight=scale_pos_weight,
        random_state=seed,
    )
    model.fit(x_train, y_train)

    y_prob = model.predict_proba(x_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    metrics = {
        "aucRoc": float(roc_auc_score(y_test, y_prob)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "calibrationError": float(expected_calibration_error(y_test, y_prob)),
    }
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1])

    return TrainedModel(
        model=model,
        feature_list=feature_list,
        metrics=metrics,
        training_sample_count=int(len(x_train)),
        confusion_matrix=cm.tolist(),
    )
