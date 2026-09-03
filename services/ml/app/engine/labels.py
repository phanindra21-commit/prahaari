"""Synthetic training labels for the per-hazard susceptibility model
(train.py).

Every label produced here is SYNTHETIC_DEMO: there is no real historical
hazard inventory wired in yet (see the TODO below). A cell's positive
probability is a smooth logistic function of its own weighted-overlay
score (so terrain the overlay already considers more susceptible is more
likely to be labelled positive), boosted near a real recorded hazard event
(data/seed/hazard-events.json) where one exists for the hazard, THEN
independently label-noised.

The label-noise step matters: a real hazard inventory reflects more than
just the causative factors already captured by the overlay (unmapped
micro-terrain, human intervention history, imperfect record-keeping), so
labels are never a deterministic re-statement of the overlay score computed
from the exact same input features. Without that noise, "training" an ML
model on a deterministic function of its own inputs produces a trivial
lookup table (AUC-ROC == 1.000 on every hazard) rather than a real learning
problem — an early version of this pipeline did exactly that, which is why
the noise step is here.

TODO(real inventory): once a real GSI landslide inventory or CWC flood
extent shapefile is available for Wayanad/Ganjam, replace
`load_real_inventory()` below to read it (e.g.
data/raw/gsi-landslide-inventory-wayanad.geojson,
data/raw/cwc-flood-extents-ganjam.geojson) and return its event points —
`generate_labels()`'s signature and every downstream caller (train.py)
stay the same either way, since both paths return the same
{h3Index -> 0/1} shape tagged with a labelSource string.
"""

from __future__ import annotations

import math

import numpy as np

LABEL_SOURCE = "SYNTHETIC_DEMO"


def load_real_inventory(hazard: str) -> list[tuple[float, float]] | None:
    """Real historical hazard-event points for `hazard`, or None if no real
    inventory is wired in yet (always None today — see the module
    docstring's TODO)."""
    return None


def _distance_km(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    klon = 111.32 * math.cos(math.radians(lat0))
    klat = 110.57
    return math.hypot((lon1 - lon0) * klon, (lat1 - lat0) * klat)


def generate_labels(
    lons: np.ndarray,
    lats: np.ndarray,
    overlay_scores: np.ndarray,
    event_points: list[tuple[float, float]] | None = None,
    *,
    event_radius_km: float = 3.0,
    event_boost: float = 0.35,
    logistic_steepness: float = 8.0,
    noise_rate: float = 0.12,
    grey_zone_halfwidth: float = 0.03,
    seed: int = 42,
) -> tuple[np.ndarray, str]:
    """Builds a label array (1/0/-1, -1 = unlabelled/excluded) aligned with
    lons/lats/overlay_scores. Positive probability is `sigmoid(logistic_steepness
    * (overlay_score - median))`, boosted by `event_boost` near a real event,
    then each label is independently flipped with probability `noise_rate`.
    Cells within `grey_zone_halfwidth` of the median overlay score (and not
    near a real event) are left unlabelled — the same "don't force a coin
    flip on the ambiguous middle" reasoning as a hard quantile cutoff, without
    making the labels a deterministic function of the cutoff itself."""
    rng = np.random.default_rng(seed)
    n = len(lons)

    near_event = np.zeros(n, dtype=bool)
    if event_points:
        for lon0, lat0 in event_points:
            d = np.array([_distance_km(lon0, lat0, lon, lat) for lon, lat in zip(lons, lats)])
            near_event |= d <= event_radius_km

    center = float(np.median(overlay_scores))
    base_prob = 1.0 / (1.0 + np.exp(-logistic_steepness * (overlay_scores - center)))
    positive_prob = np.clip(base_prob + event_boost * near_event, 0.0, 1.0)

    positive = rng.random(n) < positive_prob
    flip = rng.random(n) < noise_rate
    positive = np.where(flip, ~positive, positive)

    labels = positive.astype(int)
    grey_zone = np.abs(overlay_scores - center) < grey_zone_halfwidth
    labels[grey_zone & ~near_event] = -1

    return labels, LABEL_SOURCE
