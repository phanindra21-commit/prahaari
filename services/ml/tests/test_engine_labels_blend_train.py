import numpy as np

from app.engine.blend import blended_score
from app.engine.labels import LABEL_SOURCE, generate_labels
from app.engine.train import expected_calibration_error, spatial_block_split, train_hazard_model

HAZARDS = ["landslide", "flood", "coastalErosion", "cloudburst"]

FACTOR_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "landslide": {
        "slope": (1, 45),
        "lithology": (0, 1),
        "landCover": (0, 1),
        "antecedentRainfallIndex": (0, 1),
        "soilDepth": (0.3, 6),
        "distanceToDrainage": (0, 2.5),
        "distanceToRoadCut": (0, 1.2),
        "historicalIncidentDensity": (0, 1),
        "curvature": (0, 1),
        "aspect": (0, 1),
    },
    "flood": {
        "elevation": (0, 150),
        "rainfallIntensity": (0, 1),
        "distanceToRiver": (0, 2.5),
        "twi": (1, 18),
        "drainageDensity": (0, 1),
        "landCover": (0, 1),
        "soilInfiltration": (3, 55),
        "historicalInundation": (0, 1),
    },
    "coastalErosion": {
        "shorelineChangeRate": (0, 4),
        "elevation": (0, 220),
        "waveEnergy": (0, 1),
        "geomorphology": (0, 1),
        "tidalRange": (0.5, 4.5),
        "mangroveDuneBufferPresence": (0, 1),
    },
    "cloudburst": {
        "orographicIndex": (0, 1),
        "historicalCloudburstDensity": (0, 1),
        "slope": (1, 45),
        "elevation": (650, 2200),
        "drainageCapacity": (0, 1),
    },
}


def _random_factors(rng: np.random.Generator, hazard: str, n: int) -> list[dict[str, float]]:
    ranges = FACTOR_RANGES[hazard]
    columns = {name: rng.uniform(lo, hi, n) for name, (lo, hi) in ranges.items()}
    return [{name: float(columns[name][i]) for name in ranges} for i in range(n)]


def test_blended_score_matches_configured_alpha():
    # blend-config.json landslide alpha = 0.6
    assert blended_score(1.0, 0.0, "landslide") == 0.6
    assert blended_score(0.0, 1.0, "landslide") == 0.4
    assert blended_score(0.5, 0.5, "landslide") == 0.5


def test_generate_labels_shape_and_value_set():
    rng = np.random.default_rng(1)
    n = 500
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    factors = _random_factors(rng, "landslide", n)

    labels, source = generate_labels(lons, lats, factors, "landslide")
    assert source == LABEL_SOURCE
    assert labels.shape == (n,)
    assert set(np.unique(labels)).issubset({0, 1})


def test_generate_labels_rejects_an_unknown_hazard():
    rng = np.random.default_rng(1)
    n = 10
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    factors = _random_factors(rng, "landslide", n)
    try:
        generate_labels(lons, lats, factors, "earthquake")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_generate_labels_base_rate_is_a_rare_event_not_a_coin_flip():
    rng = np.random.default_rng(5)
    n = 6000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    for hazard in HAZARDS:
        factors = _random_factors(rng, hazard, n)
        labels, _ = generate_labels(lons, lats, factors, hazard)
        positive_rate = labels.mean()
        assert 0.05 < positive_rate < 0.30, f"{hazard} positive rate {positive_rate:.3f} not in a rare-event range"


def test_generate_labels_landslide_latent_drives_the_label_indirectly():
    # Steep, wet, weak (high-erodibility) terrain should be labelled positive
    # far more often than gentle, dry, competent terrain — the physical
    # relationship the latent process encodes — without any single factor
    # value being a deterministic cutoff.
    rng = np.random.default_rng(6)
    n = 3000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)

    high_risk = [
        {
            "slope": float(rng.uniform(35, 45)),
            "lithology": float(rng.uniform(0.6, 1.0)),
            "landCover": float(rng.uniform(0, 0.3)),
            "antecedentRainfallIndex": float(rng.uniform(0.7, 1.0)),
            "soilDepth": float(rng.uniform(2, 6)),
            "distanceToDrainage": float(rng.uniform(0, 2.5)),
            "distanceToRoadCut": float(rng.uniform(0, 1.2)),
            "historicalIncidentDensity": float(rng.uniform(0, 1)),
            "curvature": float(rng.uniform(0, 1)),
            "aspect": float(rng.uniform(0, 1)),
        }
        for _ in range(n)
    ]
    low_risk = [
        {
            "slope": float(rng.uniform(1, 10)),
            "lithology": float(rng.uniform(0, 0.3)),
            "landCover": float(rng.uniform(0.7, 1.0)),
            "antecedentRainfallIndex": float(rng.uniform(0, 0.2)),
            "soilDepth": float(rng.uniform(0.3, 1.5)),
            "distanceToDrainage": float(rng.uniform(0, 2.5)),
            "distanceToRoadCut": float(rng.uniform(0, 1.2)),
            "historicalIncidentDensity": float(rng.uniform(0, 1)),
            "curvature": float(rng.uniform(0, 1)),
            "aspect": float(rng.uniform(0, 1)),
        }
        for _ in range(n)
    ]

    # Combined into one call: z-scoring/calibration happens across the whole
    # population, so the two groups' *relative* label rates are meaningful.
    # Calling generate_labels separately on each homogeneous group would
    # re-center and re-calibrate each to the same target base rate on its
    # own, hiding the very difference this test checks for.
    combined_factors = high_risk + low_risk
    combined_lons = np.concatenate([lons, lons])
    combined_lats = np.concatenate([lats, lats])
    labels, _ = generate_labels(combined_lons, combined_lats, combined_factors, "landslide", seed=11)
    high_labels = labels[:n]
    low_labels = labels[n:]
    assert high_labels.mean() > low_labels.mean() + 0.2


def test_generate_labels_is_stochastic_not_a_deterministic_lookup():
    # Regression guard: an earlier version derived labels from a hard
    # quantile cutoff on the model's own linear-combination overlay score,
    # which made "training" a deterministic lookup table (AUC-ROC == 1.000
    # on every hazard). Identical factors with a different seed must not
    # always produce identical labels.
    rng = np.random.default_rng(3)
    n = 2000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    factors = _random_factors(rng, "flood", n)

    labels_a, _ = generate_labels(lons, lats, factors, "flood", seed=7)
    labels_b, _ = generate_labels(lons, lats, factors, "flood", seed=8)
    assert not np.array_equal(labels_a, labels_b)


def test_generate_labels_near_event_boosts_positive_probability():
    rng = np.random.default_rng(4)
    n = 4000
    half = n // 2
    lons = np.concatenate([rng.uniform(75.499, 75.501, half), rng.uniform(75.0, 75.3, n - half)])
    lats = np.concatenate([rng.uniform(11.499, 11.501, half), rng.uniform(11.0, 11.3, n - half)])
    factors = _random_factors(rng, "landslide", n)
    event_points = [(75.5, 11.5)]

    labels, _ = generate_labels(lons, lats, factors, "landslide", event_points, event_radius_km=5.0)

    near = np.zeros(n, dtype=bool)
    near[:half] = True
    far = ~near
    assert labels[near].mean() > labels[far].mean()


def test_spatial_block_split_keeps_a_parent_cells_children_together():
    # Two children of the same resolution-8 parent must always land on the
    # same side of the split (that's the point of a spatial block split).
    import h3

    parent = h3.latlng_to_cell(11.6, 76.0, 5)
    children = list(h3.cell_to_children(parent, 8))[:2]
    other_parent_child = h3.cell_to_children(h3.latlng_to_cell(19.0, 84.6, 5), 8)
    other_child = next(iter(other_parent_child))

    test_mask = spatial_block_split([children[0], children[1], other_child], parent_resolution=5)
    assert test_mask[0] == test_mask[1]


def test_expected_calibration_error_is_zero_for_perfectly_calibrated_predictions():
    y_true = np.array([0, 0, 1, 1] * 25)
    y_prob = np.array([0.0, 0.0, 1.0, 1.0] * 25)
    assert expected_calibration_error(y_true, y_prob) == 0.0


def test_expected_calibration_error_is_positive_for_overconfident_predictions():
    y_true = np.array([0, 1] * 50)
    y_prob = np.array([0.9, 0.9] * 50)  # always confident, right only half the time
    assert expected_calibration_error(y_true, y_prob) > 0.3


def test_trained_model_auc_lands_in_the_realistic_band_for_every_hazard():
    # Regression guard for the OPPOSITE failure too: not just "not a
    # deterministic lookup table" (AUC ~1.0), but also "not at/near chance"
    # (AUC ~0.5-0.64, an earlier over-corrected fix). 0.65-0.92 is a wider
    # tolerance band around the 0.72-0.85 design target, since a synthetic,
    # uncorrelated-factor test fixture won't reproduce production's exact
    # numbers (data/processed/'s spatially-coherent factors do) — see
    # scripts/run_scoring_pipeline.py for the real, tighter numbers.
    rng = np.random.default_rng(42)
    n = 4000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)

    for hazard in HAZARDS:
        factors = _random_factors(rng, hazard, n)
        h3_indexes = [f"testcell{hazard}{i:05d}" for i in range(n)]
        # spatial_block_split only needs a valid H3 index per cell for parent
        # lookup — reuse real cells across a spread of coordinates instead.
        import h3

        h3_indexes = [h3.latlng_to_cell(lat, lon, 8) for lon, lat in zip(lons, lats)]

        feature_list = sorted(FACTOR_RANGES[hazard].keys())
        features = np.array([[row[f] for f in feature_list] for row in factors])
        labels, _ = generate_labels(lons, lats, factors, hazard, seed=42)

        trained = train_hazard_model(features, feature_list, labels, h3_indexes, seed=42)
        auc = trained.metrics["aucRoc"]
        assert 0.65 <= auc <= 0.92, f"{hazard} AUC-ROC {auc:.3f} outside the realistic band [0.65, 0.92]"
        assert len(trained.confusion_matrix) == 2
        assert len(trained.confusion_matrix[0]) == 2
