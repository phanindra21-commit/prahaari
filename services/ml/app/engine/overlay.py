"""Weighted-overlay susceptibility score (METHODOLOGY §1.1):

    LSI = sum(W_i * R_i)   for causative factors i

`R_i` in [1, 5] (reclassify.py), `W_i` sums to 1 per hazard
(packages/shared/src/config/hazard-weights.json, enforced by the config
loader), so `LSI` lands in [1, 5]. Normalized to [0, 1] here for blending
with the ML score (blend.py) and comparison against zone-thresholds.json.
"""

from __future__ import annotations

from app.config_loader import HAZARD_WEIGHTS
from app.engine.reclassify import reclassify_cell

LSI_MIN, LSI_MAX = 1.0, 5.0


def overlay_score(factors: dict[str, float], hazard: str) -> float:
    """Raw causative-factor values in, normalized-to-[0,1] overlay score out."""
    ratings = reclassify_cell(factors, hazard)
    weights = HAZARD_WEIGHTS["hazards"][hazard]["factors"]
    lsi = sum(weights[name] * rating for name, rating in ratings.items())
    normalized = (lsi - LSI_MIN) / (LSI_MAX - LSI_MIN)
    return max(0.0, min(1.0, normalized))
