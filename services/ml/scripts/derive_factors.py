"""Synthetic-but-spatially-coherent causative-factor generator.

Reads the `{h3Index, lon, lat}` cell list that
`apps/api/src/scripts/generateGrid.ts` exports to
`data/processed/<district>-grid.json`, computes a raw value for every
causative factor named in `packages/shared/src/config/hazard-weights.json`
(one factor set per hazard the district is actually exposed to — its
`primaryHazards`), and writes `data/processed/<district>-factors.json` for
`apps/api/src/scripts/ingestFactors.ts` to load back into `GridCell.factors`.

Every value here is SYNTHETIC_DEMO: built from smooth deterministic
geographic trends (distance to an escarpment/coastline/river, elevation
gradients) plus low-frequency spatially-coherent noise — never
cell-independent white noise, since a real causative-factor raster is
never independent from cell to cell. This is NOT derived from real DEMs,
soil surveys, or satellite imagery; see docs/ZONING_PIPELINE.md for how a
real raster pipeline (SRTM/Bhuvan DEM, Bhukosh lithology, Sentinel-2 land
cover, etc.) would replace this script without changing anything
downstream (the engine only ever sees a `{h3Index -> {hazard -> {factor:
value}}}` mapping).

Usage (from services/ml, with the venv active):
    python scripts/derive_factors.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Sequence

import numpy as np

PROCESSED_DIR = Path(__file__).resolve().parents[3] / "data" / "processed"

LAT_KM_PER_DEG = 110.57  # near-constant across latitude


def _lon_km_per_deg(lat_deg: float) -> float:
    return 111.32 * math.cos(math.radians(lat_deg))


def equirect_distance_km(
    lons: np.ndarray, lats: np.ndarray, origin_lon: float, origin_lat: float
) -> np.ndarray:
    """Flat-earth approximation — fine at this scale (tens of km)."""
    dx = (lons - origin_lon) * _lon_km_per_deg(origin_lat)
    dy = (lats - origin_lat) * LAT_KM_PER_DEG
    return np.sqrt(dx**2 + dy**2)


def distance_to_polyline_km(
    lons: np.ndarray, lats: np.ndarray, line: Sequence[tuple[float, float]], samples_per_segment: int = 40
) -> np.ndarray:
    """Min distance from every point to a densely-resampled polyline (a synthetic river/road/coastline)."""
    points: list[tuple[float, float]] = []
    for (lon0, lat0), (lon1, lat1) in zip(line[:-1], line[1:]):
        for t in np.linspace(0, 1, samples_per_segment, endpoint=False):
            points.append((lon0 + t * (lon1 - lon0), lat0 + t * (lat1 - lat0)))
    points.append(line[-1])
    pts = np.array(points)

    mean_lat = float(np.mean(lats))
    klon = _lon_km_per_deg(mean_lat)
    gx = (lons[:, None] - pts[None, :, 0]) * klon
    gy = (lats[:, None] - pts[None, :, 1]) * LAT_KM_PER_DEG
    return np.sqrt(gx**2 + gy**2).min(axis=1)


def coherent_field(
    lons: np.ndarray, lats: np.ndarray, bbox: tuple[float, float, float, float], seed: int, grid_n: int = 8
) -> np.ndarray:
    """A smooth 0-1 field: a coarse `grid_n x grid_n` random grid, bilinearly interpolated at every
    (lon, lat). Deliberately low-frequency (not white noise) — this is what gives the synthetic
    factor rasters spatial coherence: neighboring cells always get similar values."""
    lon_min, lon_max, lat_min, lat_max = bbox
    rng = np.random.default_rng(seed)
    coarse = rng.random((grid_n, grid_n))

    fx = np.clip((lons - lon_min) / (lon_max - lon_min) * (grid_n - 1), 0, grid_n - 1 - 1e-9)
    fy = np.clip((lats - lat_min) / (lat_max - lat_min) * (grid_n - 1), 0, grid_n - 1 - 1e-9)
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    x1, y1 = x0 + 1, y0 + 1
    tx, ty = fx - x0, fy - y0

    top = coarse[y0, x0] * (1 - tx) + coarse[y0, x1] * tx
    bottom = coarse[y1, x0] * (1 - tx) + coarse[y1, x1] * tx
    return top * (1 - ty) + bottom * ty


def gaussian_bump(lons: np.ndarray, lats: np.ndarray, center_lon: float, center_lat: float, sigma_km: float) -> np.ndarray:
    d = equirect_distance_km(lons, lats, center_lon, center_lat)
    return np.exp(-0.5 * (d / sigma_km) ** 2)


def normalize01(arr: np.ndarray) -> np.ndarray:
    lo, hi = float(arr.min()), float(arr.max())
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


def clamp(arr: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(arr, lo, hi)


# --- Wayanad geography anchors -----------------------------------------
# Real coordinates of the 2024 Chooralmala/Mundakkai landslide (see
# data/seed/hazard-events.json) — just south of the synthetic district
# bounding box (data/seed/districts.json), which pre-dates this step. The
# escarpment gradient below still peaks toward that corner of the grid, so
# "steepest near Chooralmala/Mundakkai" holds directionally across the
# cells that actually exist.
WAYANAD_BBOX = (75.85, 76.55, 11.55, 11.95)
WAYANAD_ESCARPMENT = (76.086, 11.510)
WAYANAD_RIVER = [(75.90, 11.60), (76.05, 11.65), (76.20, 11.75), (76.40, 11.85), (76.50, 11.92)]
WAYANAD_ROAD = [(75.90, 11.90), (76.10, 11.80), (76.30, 11.68), (76.50, 11.58)]

# --- Ganjam geography anchors -------------------------------------------
# Coast modelled as a NE-trending line along the bbox's eastern edge
# (roughly tracing Gopalpur -> Rushikulya mouth -> Chilika-lake side),
# river as a line reaching the coast from inland.
GANJAM_BBOX = (84.5, 85.35, 18.95, 19.95)
GANJAM_COAST = [(85.30, 18.97), (85.22, 19.25), (85.12, 19.55), (85.05, 19.80), (85.00, 19.95)]
GANJAM_RIVER = [(84.55, 19.10), (84.75, 19.20), (85.00, 19.30), (85.20, 19.35)]


def wayanad_factors(lons: np.ndarray, lats: np.ndarray) -> dict[str, dict[str, np.ndarray]]:
    bbox = WAYANAD_BBOX
    d_escarp = equirect_distance_km(lons, lats, *WAYANAD_ESCARPMENT)

    elevation_amsl = clamp(
        2100 * np.exp(-d_escarp / 18.0) + 700 + 150 * coherent_field(lons, lats, bbox, 101, 10), 650, 2200
    )
    slope = clamp(38 * np.exp(-d_escarp / 12.0) + 4 + 6 * coherent_field(lons, lats, bbox, 102, 14), 1, 45)
    lithology = clamp(
        0.25 + 0.5 * coherent_field(lons, lats, bbox, 103, 6) + 0.25 * np.exp(-d_escarp / 15), 0, 1
    )
    land_cover = clamp(0.3 + 0.55 * coherent_field(lons, lats, bbox, 104, 8), 0, 1)
    antecedent_rainfall = clamp(
        0.7 * normalize01(elevation_amsl) + 0.3 * coherent_field(lons, lats, bbox, 105, 10), 0, 1
    )
    soil_depth = clamp(5.5 - 0.1 * slope + 0.6 * coherent_field(lons, lats, bbox, 106, 10), 0.3, 6.0)
    distance_to_drainage = clamp(distance_to_polyline_km(lons, lats, WAYANAD_RIVER), 0, 2.5)
    distance_to_road_cut = clamp(distance_to_polyline_km(lons, lats, WAYANAD_ROAD), 0, 1.2)
    historical_incident_density = clamp(
        0.9 * gaussian_bump(lons, lats, *WAYANAD_ESCARPMENT, sigma_km=6)
        + 0.1 * coherent_field(lons, lats, bbox, 107, 10),
        0,
        1,
    )
    curvature = clamp(coherent_field(lons, lats, bbox, 108, 9), 0, 1)
    aspect = clamp(coherent_field(lons, lats, bbox, 109, 9), 0, 1)

    landslide = {
        "slope": slope,
        "lithology": lithology,
        "landCover": land_cover,
        "antecedentRainfallIndex": antecedent_rainfall,
        "soilDepth": soil_depth,
        "distanceToDrainage": distance_to_drainage,
        "distanceToRoadCut": distance_to_road_cut,
        "historicalIncidentDensity": historical_incident_density,
        "curvature": curvature,
        "aspect": aspect,
    }

    # Flood "elevation" is Height-Above-Nearest-Drainage (HAND), a
    # standard local-relief flood-susceptibility proxy — not absolute
    # AMSL. Wayanad's real AMSL (650-2200m, used above and for
    # cloudburst below) would saturate the hazard-generic low-elevation
    # breakpoint table in factor-reclassification.json at the safest
    # rating everywhere in a hill district, erasing real local variation
    # between a valley-bottom habitation and a ridge-top one.
    elevation_hand = clamp(
        8 * distance_to_drainage**1.3 + 20 * coherent_field(lons, lats, bbox, 110, 12), 0, 150
    )
    rainfall_intensity = antecedent_rainfall  # same orographic driver
    distance_to_river = distance_to_drainage
    twi = clamp(14 - 0.08 * elevation_hand - 0.15 * slope + 2 * coherent_field(lons, lats, bbox, 111, 10), 1, 18)
    drainage_density = clamp(
        1 - 0.8 * normalize01(distance_to_drainage) + 0.2 * coherent_field(lons, lats, bbox, 112, 10), 0, 1
    )
    land_cover_imperviousness = clamp(0.15 + 0.5 * coherent_field(lons, lats, bbox, 113, 10), 0, 1)
    soil_infiltration = clamp(45 - 0.2 * slope + 10 * coherent_field(lons, lats, bbox, 114, 10), 3, 55)
    historical_inundation = clamp(
        0.7 * (1 - normalize01(elevation_hand)) + 0.3 * coherent_field(lons, lats, bbox, 115, 10), 0, 1
    )

    flood = {
        "elevation": elevation_hand,
        "rainfallIntensity": rainfall_intensity,
        "distanceToRiver": distance_to_river,
        "twi": twi,
        "drainageDensity": drainage_density,
        "landCover": land_cover_imperviousness,
        "soilInfiltration": soil_infiltration,
        "historicalInundation": historical_inundation,
    }

    # Orographic uplift potential. Two miscalibrations relative to landslide
    # fixed here, both diagnosed by comparing overlay-score distributions
    # (see docs/METHODOLOGY.md's Validation section for the before/after
    # numbers):
    #
    # 1. The old formula, `0.5*normalize01(slope) + 0.5*normalize01(elevation_amsl)`,
    #    locally rescaled BOTH terms to fill [0,1] across this district's own
    #    cell population — so Wayanad's own top-ranked cells always hit
    #    orographicIndex ~= 1.0 regardless of how extreme their terrain
    #    actually is. Landslide's own dominant factor (`slope`, weight 0.2 of
    #    landslide's LSI) is never rescaled like this — a cell's slope factor
    #    only reaches rating 5 above an ABSOLUTE 40 degrees. Fixed to a real
    #    physical denominator instead of a relative one.
    # 2. Reusing `elevation_amsl` inside orographicIndex double-counted
    #    elevation: cloudburst ALSO carries elevation as its own separate
    #    factor below (weight 0.15). Between orographicIndex's elevation
    #    term and the standalone `elevation` factor, terrain elevation was
    #    being counted twice in cloudburst's LSI (landslide has no
    #    standalone elevation factor at all) — an inflation mechanism
    #    independent of the local-vs-absolute scaling issue. Fixed by
    #    dropping elevation from orographicIndex entirely: it stays purely
    #    slope-driven (the actual meteorological trigger for orographic
    #    lift — moist air forced upward by a windward slope), scaled
    #    against a genuinely steep 40-degree reference (matched to
    #    landslide's OWN top slope breakpoint, not a lower one) since
    #    pronounced orographic rainfall enhancement requires steeper
    #    terrain than the moderate slopes (10-30 degrees) that alone can
    #    already trigger landslide instability given the right soil/
    #    rainfall conditions.
    orographic_index = clamp(slope / 40.0, 0, 1)
    # A THIRD miscalibration, found only after re-running the pipeline with
    # fixes 1-2 above: historicalCloudburstDensity was ALSO a gaussian bump
    # anchored at WAYANAD_ESCARPMENT — the real 2024 Chooralmala/Mundakkai
    # LANDSLIDE site (see data/seed/hazard-events.json) — at weight 0.25,
    # cloudburst's second-largest factor. Landslide's own historicalIncidentDensity
    # uses the SAME anchor, but at only weight 0.06. The real historical
    # record at that point is a LANDSLIDE, not a cloudburst: fabricating a
    # synthetic "historical cloudburst density" peak at the exact site of a
    # recorded landslide is not physically justified — there is no real
    # cloudburst inventory in this dataset to anchor to (disaster_history.py,
    # 1B, is the correct place for a real recorded event to elevate a
    # habitation's exposure, and it already does so for the correct hazard
    # type only). Fixed by dropping the escarpment-anchored bump entirely:
    # this field is now a LOW-magnitude coherent-noise proxy (mean ~0.1,
    # matching this factor's own former typical value away from the bump —
    # i.e. everywhere except the small handful of cells the old bump
    # actually covered) rather than the ~0.5-mean a bare coherent_field()
    # would give it: an honest "we have no real cloudburst historical
    # signal, so this stays uniformly weak" rather than an invented peak
    # borrowed from a different hazard's real event, and without silently
    # inflating cloudburst's LSI district-wide by swapping one bias for
    # another.
    historical_cloudburst_density = clamp(0.2 * coherent_field(lons, lats, bbox, 116, 10), 0, 1)
    # Same absolute-threshold fix as orographicIndex above (was normalize01(slope)).
    drainage_capacity = clamp(1 - 0.5 * clamp(slope / 40.0, 0, 1) + 0.3 * coherent_field(lons, lats, bbox, 117, 10), 0, 1)

    cloudburst = {
        "orographicIndex": orographic_index,
        "historicalCloudburstDensity": historical_cloudburst_density,
        "slope": slope,
        "elevation": elevation_amsl,
        "drainageCapacity": drainage_capacity,
    }

    return {"landslide": landslide, "flood": flood, "cloudburst": cloudburst}


def ganjam_factors(lons: np.ndarray, lats: np.ndarray) -> dict[str, dict[str, np.ndarray]]:
    bbox = GANJAM_BBOX
    d_coast = distance_to_polyline_km(lons, lats, GANJAM_COAST)
    d_river = distance_to_polyline_km(lons, lats, GANJAM_RIVER)

    elevation = clamp(6 * d_coast**0.85 + 15 * coherent_field(lons, lats, bbox, 201, 10), 0, 220)
    slope = clamp(0.15 * np.sqrt(elevation) + 3 * coherent_field(lons, lats, bbox, 202, 12), 0.5, 18)

    shoreline_change_rate = clamp(
        3.8 * np.exp(-d_coast / 3.0) + 0.3 * coherent_field(lons, lats, bbox, 203, 10), 0, 4.2
    )
    wave_energy = clamp(0.9 * np.exp(-d_coast / 4.0) + 0.1 * coherent_field(lons, lats, bbox, 204, 10), 0, 1)
    geomorphology = clamp(
        0.3 + 0.5 * coherent_field(lons, lats, bbox, 205, 8) + 0.2 * np.exp(-d_coast / 5), 0, 1
    )
    tidal_range = clamp(2.2 + 1.0 * coherent_field(lons, lats, bbox, 206, 6), 0.5, 4.5)

    # Mangrove/dune buffer is only physically meaningful right at the
    # coast; present along the northern stretch (toward the
    # Chilika-adjacent belt, lat > ~19.3), sparser to the south.
    northern_belt = clamp((lats - 19.3) / 0.5, 0, 1)
    mangrove_buffer = clamp(
        (0.15 + 0.65 * northern_belt) * np.exp(-d_coast / 2.5) + 0.05 * coherent_field(lons, lats, bbox, 207, 10),
        0,
        1,
    )

    coastal_erosion = {
        "shorelineChangeRate": shoreline_change_rate,
        "elevation": elevation,
        "waveEnergy": wave_energy,
        "geomorphology": geomorphology,
        "tidalRange": tidal_range,
        "mangroveDuneBufferPresence": mangrove_buffer,
    }

    # Cyclone landfall concentrates short-duration extreme rainfall near
    # the coast, unlike Wayanad's orographic (elevation-correlated) driver.
    rainfall_intensity = clamp(
        0.55 + 0.35 * np.exp(-d_coast / 25) + 0.2 * coherent_field(lons, lats, bbox, 208, 10), 0, 1
    )
    distance_to_river = clamp(d_river, 0, 12)
    twi = clamp(15 - 0.05 * elevation - 0.2 * slope + 2 * coherent_field(lons, lats, bbox, 209, 10), 1, 18)
    drainage_density = clamp(
        1 - 0.05 * distance_to_river + 0.2 * coherent_field(lons, lats, bbox, 210, 10), 0, 1
    )
    land_cover_imperviousness = clamp(0.2 + 0.5 * coherent_field(lons, lats, bbox, 211, 10), 0, 1)
    soil_infiltration = clamp(10 + 0.15 * elevation + 8 * coherent_field(lons, lats, bbox, 212, 10), 3, 55)
    historical_inundation = clamp(
        0.6 * np.exp(-distance_to_river / 4) + 0.4 * np.exp(-d_coast / 6) * coherent_field(lons, lats, bbox, 213, 10),
        0,
        1,
    )

    flood = {
        "elevation": elevation,
        "rainfallIntensity": rainfall_intensity,
        "distanceToRiver": distance_to_river,
        "twi": twi,
        "drainageDensity": drainage_density,
        "landCover": land_cover_imperviousness,
        "soilInfiltration": soil_infiltration,
        "historicalInundation": historical_inundation,
    }

    return {"coastalErosion": coastal_erosion, "flood": flood}


DISTRICT_FACTOR_FNS = {
    "wayanad": wayanad_factors,
    "ganjam": ganjam_factors,
}


def neighbor_coherence(h3_indexes: list[str], values: np.ndarray) -> float:
    """Mean |value(cell) - value(neighbor)| across every cell's immediate H3 ring, as evidence the
    field is smooth rather than white noise (a white-noise field would show no such locality)."""
    import h3

    index_of = {h: i for i, h in enumerate(h3_indexes)}
    diffs: list[float] = []
    for h, i in index_of.items():
        for neighbor in h3.grid_ring(h, 1):
            j = index_of.get(neighbor)
            if j is not None:
                diffs.append(abs(float(values[i]) - float(values[j])))
    return float(np.mean(diffs)) if diffs else float("nan")


def process_district(slug: str) -> None:
    grid_path = PROCESSED_DIR / f"{slug}-grid.json"
    if not grid_path.exists():
        raise FileNotFoundError(
            f"[derive_factors] {grid_path} not found — run `npm run generate-grid` (apps/api) first."
        )
    rows = json.loads(grid_path.read_text(encoding="utf-8"))
    h3_indexes = [r["h3Index"] for r in rows]
    lons = np.array([r["lon"] for r in rows])
    lats = np.array([r["lat"] for r in rows])

    factors = DISTRICT_FACTOR_FNS[slug](lons, lats)

    output: dict[str, dict[str, dict[str, float]]] = {h: {} for h in h3_indexes}
    for hazard, hazard_factors in factors.items():
        for factor_name, values in hazard_factors.items():
            for h3_index, value in zip(h3_indexes, values):
                output[h3_index].setdefault(hazard, {})[factor_name] = round(float(value), 4)

    out_path = PROCESSED_DIR / f"{slug}-factors.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"[derive_factors] {slug}: wrote factors for {len(h3_indexes)} cells -> {out_path}")

    for hazard, hazard_factors in factors.items():
        print(f"[derive_factors]   {hazard}:")
        for factor_name, values in hazard_factors.items():
            coherence = neighbor_coherence(h3_indexes, values)
            spread = float(values.max() - values.min())
            print(
                f"[derive_factors]     {factor_name:28s} range=[{values.min():7.3f}, {values.max():7.3f}]  "
                f"meanNeighborDiff={coherence:6.4f}  (spread={spread:6.3f}, "
                f"{'coherent — neighbor diffs << full range' if coherence < 0.25 * spread else 'CHECK: neighbor diffs not small relative to spread'})"
            )


def main() -> None:
    for slug in DISTRICT_FACTOR_FNS:
        process_district(slug)


if __name__ == "__main__":
    main()
