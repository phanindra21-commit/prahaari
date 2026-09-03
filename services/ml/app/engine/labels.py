"""Synthetic training labels for the per-hazard susceptibility model
(train.py).

Every label produced here is SYNTHETIC_DEMO: there is no real historical
hazard inventory wired in yet (see the TODO below). Unlike an earlier
version of this module, labels are **not** derived from the weighted-
overlay score (or any other single linear combination the model could
trivially reconstruct from its own input features). Each hazard instead
gets its own physically-motivated LATENT process — e.g. landslide's is an
infinite-slope stability proxy (driving shear stress from gravity vs.
resisting shear strength from soil cohesion, degraded by rainfall pore
pressure) — built from the same raw causative factors as the model's
features, but combined nonlinearly and with different emphasis than the
overlay's linear weighted sum. That keeps the relationship between any
single input feature and the label real, but indirect: a cell's rainfall
value alone, say, does not determine its label the way it partially
determines the overlay score.

The latent value is converted to a positive-class probability via a
logistic link, its intercept calibrated so the BASE rate (before any
event-proximity boost) matches `target_base_rate` — hazard events are
rare, not a coin flip, so positives are calibrated to ~10-20% before
event boosting pushes cells near a real recorded event further toward
positive. Every label is then independently flipped with `noise_rate`
probability, simulating the fact that a real inventory reflects more than
just these causative factors (unmapped micro-terrain, human intervention
history, imperfect record-keeping) — this is a genuine, tested
requirement, not decoration: without noise, "training" collapses to a
near-deterministic lookup table (an earlier version of this pipeline hit
AUC-ROC ~1.0 that way); with TOO MUCH noise (an earlier fix over-corrected
into this), AUC-ROC drops to ~chance (0.50-0.64) instead of the realistic
0.72-0.85 a moderately-noisy-but-genuinely-informative label process
should produce.

TODO(real inventory): once a real GSI landslide inventory or CWC flood
extent shapefile is available for Wayanad/Ganjam, replace
`load_real_inventory()` below to read it and route its points into
`generate_labels()`'s `event_points` (or bypass the latent-process labels
entirely with real ones) — `generate_labels()`'s signature and every
downstream caller (train.py, pipeline.py) stay the same either way.
"""

from __future__ import annotations

import math
from typing import Callable

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


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _landslide_latent(f: dict[str, np.ndarray]) -> np.ndarray:
    """Infinite-slope stability proxy: driving shear stress (gravity component
    along the slope) over resisting shear strength (cohesion, degraded by
    rainfall-driven pore pressure) — a standard, simplified geotechnical
    slope-stability model, not the overlay's linear weighted sum."""
    slope_rad = np.radians(np.clip(f["slope"], 1, 60))
    cohesion = 0.2 + 0.8 * (1 - np.clip(f["lithology"], 0, 1))
    rainfall = np.clip(f["antecedentRainfallIndex"], 0, 1)
    soil_depth = np.clip(f["soilDepth"], 0.1, 8)
    pore_pressure = rainfall * (1 - np.exp(-soil_depth / 2.0))

    driving = np.sin(slope_rad)
    resisting = np.clip(cohesion * np.cos(slope_rad) - 0.9 * pore_pressure * np.sin(slope_rad), 0.05, None)
    instability = driving / resisting

    forest_protection = 1 - 0.3 * (1 - np.clip(f["landCover"], 0, 1))
    return instability * forest_protection


def _flood_latent(f: dict[str, np.ndarray]) -> np.ndarray:
    """Inundation-potential proxy: convex runoff response to rainfall
    intensity, moderated by drainage capacity, times a topographic-ponding
    term (TWI, decaying with local relief above drainage) and infiltration
    deficit."""
    rainfall = np.clip(f["rainfallIntensity"], 0, 1)
    hand_elevation = np.clip(f["elevation"], 0, 200)
    twi = np.clip(f["twi"], 0, 20)
    drainage = np.clip(f["drainageDensity"], 0, 1)
    infiltration = np.clip(f["soilInfiltration"], 1, 60)

    runoff_potential = rainfall**1.5 * (1 - 0.5 * drainage)
    ponding_potential = _sigmoid(0.3 * (twi - 9)) * np.exp(-hand_elevation / 40.0)
    infiltration_deficit = 1 - infiltration / 60.0
    return runoff_potential * (0.4 + 0.6 * ponding_potential) * (0.5 + 0.5 * infiltration_deficit)


def _coastal_erosion_latent(f: dict[str, np.ndarray]) -> np.ndarray:
    """Erosion-exposure proxy: shoreline retreat rate and wave energy scaled
    superlinearly, decaying with elevation above the shore, discounted by
    protective mangrove/dune buffer presence."""
    shoreline_change = np.clip(f["shorelineChangeRate"], 0, 5)
    wave_energy = np.clip(f["waveEnergy"], 0, 1)
    elevation = np.clip(f["elevation"], 0, 250)
    buffer = np.clip(f["mangroveDuneBufferPresence"], 0, 1)

    exposure = shoreline_change**1.3 * (0.4 + 0.6 * wave_energy) * np.exp(-elevation / 15.0)
    protection = 1 - 0.6 * buffer
    return exposure * protection


def _cloudburst_latent(f: dict[str, np.ndarray]) -> np.ndarray:
    """Orographic-trigger proxy: lift potential interacting with slope
    steepness (a threshold-like term around typical windward-lift slopes),
    scaled by historical event density and discounted by drainage capacity."""
    orographic = np.clip(f["orographicIndex"], 0, 1)
    slope = np.clip(f["slope"], 1, 45)
    historical_density = np.clip(f["historicalCloudburstDensity"], 0, 1)
    drainage_capacity = np.clip(f["drainageCapacity"], 0, 1)

    lift_trigger = orographic**1.4 * _sigmoid(0.15 * (slope - 15))
    return lift_trigger * (0.5 + 0.5 * historical_density) * (1.3 - 0.3 * drainage_capacity)


LATENT_FNS: dict[str, Callable[[dict[str, np.ndarray]], np.ndarray]] = {
    "landslide": _landslide_latent,
    "flood": _flood_latent,
    "coastalErosion": _coastal_erosion_latent,
    "cloudburst": _cloudburst_latent,
}


def _factors_to_arrays(factors: list[dict[str, float]]) -> dict[str, np.ndarray]:
    keys = factors[0].keys()
    return {key: np.array([row[key] for row in factors]) for key in keys}


def _calibrate_shift(z: np.ndarray, steepness: float, target_rate: float) -> float:
    """Binary-searches the logistic intercept so mean(sigmoid(steepness *
    (z - shift))) ~= target_rate, independent of the latent function's own
    scale/units."""
    lo, hi = -8.0, 8.0
    for _ in range(50):
        mid = (lo + hi) / 2
        mean_prob = float(_sigmoid(steepness * (z - mid)).mean())
        if mean_prob > target_rate:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def generate_labels(
    lons: np.ndarray,
    lats: np.ndarray,
    factors: list[dict[str, float]],
    hazard: str,
    event_points: list[tuple[float, float]] | None = None,
    *,
    event_radius_km: float = 3.0,
    event_boost: float = 2.5,
    target_base_rate: float = 0.13,
    steepness: float = 2.9,
    noise_rate: float = 0.045,
    seed: int = 42,
) -> tuple[np.ndarray, str]:
    """Builds a 0/1 label array aligned with lons/lats/factors from a
    hazard-specific physically-motivated latent process (see LATENT_FNS),
    calibrated to a rare-event base rate (`target_base_rate`), boosted near
    real recorded events, sampled stochastically (not thresholded
    deterministically), then independently label-noised."""
    if hazard not in LATENT_FNS:
        raise ValueError(f"No latent label process defined for hazard '{hazard}'")

    rng = np.random.default_rng(seed)
    factor_arrays = _factors_to_arrays(factors)
    latent = LATENT_FNS[hazard](factor_arrays)

    z = (latent - latent.mean()) / (latent.std() + 1e-9)
    shift = _calibrate_shift(z, steepness, target_base_rate)

    near_event = np.zeros(len(lons), dtype=bool)
    if event_points:
        for lon0, lat0 in event_points:
            d = np.array([_distance_km(lon0, lat0, lon, lat) for lon, lat in zip(lons, lats)])
            near_event |= d <= event_radius_km

    boosted_z = z + event_boost * near_event
    positive_prob = _sigmoid(steepness * (boosted_z - shift))

    positive = rng.random(len(lons)) < positive_prob
    flip = rng.random(len(lons)) < noise_rate
    positive = np.where(flip, ~positive, positive)

    return positive.astype(int), LABEL_SOURCE
