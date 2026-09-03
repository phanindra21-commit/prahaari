"""Blends the weighted-overlay score with the ML susceptibility score
(METHODOLOGY §1.2):

    Susceptibility = alpha * overlayScore + (1 - alpha) * mlScore

`alpha` is loaded PER HAZARD from
packages/shared/src/config/blend-config.json — a hazard whose ML model's
AUC-ROC underperforms can be weighted back toward the interpretable
overlay without affecting any other hazard's blend. See train.py for
metrics and docs/METHODOLOGY.md §1.2 for the current per-hazard values and
why.
"""

from __future__ import annotations

from app.config_loader import BLEND_CONFIG


def blended_score(overlay_score: float, ml_score: float, hazard: str) -> float:
    alpha = BLEND_CONFIG["hazards"][hazard]["alpha"]
    return alpha * overlay_score + (1 - alpha) * ml_score
