"""Blends the weighted-overlay score with the ML susceptibility score
(METHODOLOGY §1.2):

    Susceptibility = alpha * overlayScore + (1 - alpha) * mlScore

`alpha` is loaded from packages/shared/src/config/blend-config.json —
weighted toward the interpretable overlay (0.6) while the ML model's
training labels are SYNTHETIC_DEMO (see labels.py).
"""

from __future__ import annotations

from app.config_loader import BLEND_CONFIG


def blended_score(overlay_score: float, ml_score: float) -> float:
    alpha = BLEND_CONFIG["alpha"]
    return alpha * overlay_score + (1 - alpha) * ml_score
