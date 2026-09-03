import numpy as np

from app.engine.blend import blended_score
from app.engine.labels import LABEL_SOURCE, generate_labels
from app.engine.train import expected_calibration_error, spatial_block_split


def test_blended_score_matches_configured_alpha():
    # blend-config.json alpha = 0.6
    assert blended_score(1.0, 0.0) == 0.6
    assert blended_score(0.0, 1.0) == 0.4
    assert blended_score(0.5, 0.5) == 0.5


def test_generate_labels_shape_and_value_set():
    rng = np.random.default_rng(1)
    n = 500
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    overlay_scores = rng.uniform(0, 1, n)

    labels, source = generate_labels(lons, lats, overlay_scores)
    assert source == LABEL_SOURCE
    assert labels.shape == (n,)
    assert set(np.unique(labels)).issubset({-1, 0, 1})


def test_generate_labels_higher_overlay_score_is_more_often_positive():
    rng = np.random.default_rng(2)
    n = 4000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    overlay_scores = rng.uniform(0, 1, n)

    labels, _ = generate_labels(lons, lats, overlay_scores)
    labelled = labels != -1
    high = overlay_scores > np.median(overlay_scores)

    positive_rate_high = labels[labelled & high].mean()
    positive_rate_low = labels[labelled & ~high].mean()
    assert positive_rate_high > positive_rate_low


def test_generate_labels_is_not_a_deterministic_function_of_a_single_quantile_cutoff():
    # Regression guard: an earlier version derived labels from a hard
    # quantile cutoff on the same overlay score used as model input, which
    # made the "ML" model a trivial lookup table (AUC-ROC == 1.000 on every
    # hazard). Two cells with near-identical overlay scores straddling the
    # median should NOT always land on opposite sides of the label.
    rng = np.random.default_rng(3)
    n = 2000
    lons = rng.uniform(75.0, 76.0, n)
    lats = rng.uniform(11.0, 12.0, n)
    overlay_scores = np.linspace(0, 1, n)  # deterministic ranking, no noise in the score itself

    labels, _ = generate_labels(lons, lats, overlay_scores, seed=7)
    labels_rerun_diff_seed, _ = generate_labels(lons, lats, overlay_scores, seed=8)
    assert not np.array_equal(labels, labels_rerun_diff_seed)


def test_generate_labels_near_event_boosts_positive_probability():
    # "Near" cells sit inside the function's own event_radius_km=5.0 (~0.045
    # degrees); "far" cells are placed well outside it (~0.5 degrees, ~55km)
    # so the two groups can't overlap the function's actual near_event mask.
    rng = np.random.default_rng(4)
    n = 4000
    half = n // 2
    lons = np.concatenate([rng.uniform(75.499, 75.501, half), rng.uniform(75.0, 75.3, n - half)])
    lats = np.concatenate([rng.uniform(11.499, 11.501, half), rng.uniform(11.0, 11.3, n - half)])
    # overlay_scores independent of location: any positive-rate gap between
    # the near/far groups below is attributable to event proximity, not to
    # overlay score differing systematically between the two groups.
    overlay_scores = rng.uniform(0, 1, n)
    event_points = [(75.5, 11.5)]

    labels, _ = generate_labels(lons, lats, overlay_scores, event_points, event_radius_km=5.0)

    near = np.zeros(n, dtype=bool)
    near[:half] = True
    far = ~near
    assert labels[near & (labels != -1)].mean() > labels[far & (labels != -1)].mean()


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
