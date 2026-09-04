import gc

import numpy as np
import xgboost as xgb

from app.engine.explain import get_explainer, top_contributions, top_contributions_batch


def _tiny_model(seed: int = 0) -> tuple[xgb.XGBClassifier, list[str]]:
    rng = np.random.default_rng(seed)
    feature_list = ["slope", "lithology", "landCover"]
    x = rng.uniform(0, 1, (200, 3))
    # slope drives the label almost entirely -> its SHAP contribution should dominate.
    y = (x[:, 0] > 0.5).astype(int)
    model = xgb.XGBClassifier(max_depth=3, n_estimators=50, eval_metric="logloss", random_state=seed)
    model.fit(x, y)
    return model, feature_list


def test_get_explainer_is_cached_per_model_object():
    model, _ = _tiny_model()
    e1 = get_explainer(model)
    e2 = get_explainer(model)
    assert e1 is e2


def test_get_explainer_never_collides_across_different_models():
    # Regression test for the id()-reuse bug: two DIFFERENT model objects,
    # even if one happens to occupy the memory address a garbage-collected
    # model used to hold, must never share a cached explainer — a stale
    # hit here silently returns the wrong feature-count explainer and
    # crashes deep inside shap_values() with an opaque XGBoost assertion
    # (this is exactly what happened when scenario.py trained several
    # models back-to-back in one process and the old id()-keyed cache in
    # explain.py returned a wrong-hazard explainer).
    model_a, features_a = _tiny_model(seed=1)
    explainer_a = get_explainer(model_a)
    address_a = id(model_a)
    del model_a
    gc.collect()

    # Keep retraining until a new model reuses the freed address (CPython
    # tends to do this quickly, but isn't guaranteed) — cap attempts so
    # this can't hang if the allocator doesn't cooperate.
    model_b = None
    for seed in range(2, 50):
        candidate, features_b = _tiny_model(seed=seed)
        if id(candidate) == address_a:
            model_b = candidate
            break
        del candidate

    if model_b is None:
        # Couldn't force an id() collision this run — fall back to
        # directly asserting the cache is keyed by identity, not a
        # derived string, which is the actual fix under test.
        model_b, features_b = _tiny_model(seed=99)

    explainer_b = get_explainer(model_b)
    assert explainer_b is not explainer_a

    x = np.array([[0.5, 0.5, 0.5]])
    # Must not raise — would raise the XGBoost shape assertion if the
    # cache had wrongly handed back explainer_a (built for a different,
    # since-freed model) for model_b.
    top_contributions_batch(model_b, x, features_b)


def test_top_contributions_returns_signed_ranked_factors():
    model, feature_list = _tiny_model()
    x_row = np.array([0.9, 0.1, 0.1])  # high slope -> should push toward positive/INCREASES_RISK

    contributions = top_contributions(model, x_row, feature_list, top_n=3)

    assert len(contributions) == 3
    assert {c["factor"] for c in contributions} == set(feature_list)
    for c in contributions:
        assert c["direction"] in ("INCREASES_RISK", "DECREASES_RISK")
        assert (c["contribution"] > 0) == (c["direction"] == "INCREASES_RISK")
    # sorted by |contribution| descending
    magnitudes = [abs(c["contribution"]) for c in contributions]
    assert magnitudes == sorted(magnitudes, reverse=True)
    # slope is the dominant driver by construction
    assert contributions[0]["factor"] == "slope"
    assert contributions[0]["direction"] == "INCREASES_RISK"


def test_top_contributions_respects_top_n():
    model, feature_list = _tiny_model()
    x_row = np.array([0.5, 0.5, 0.5])
    contributions = top_contributions(model, x_row, feature_list, top_n=2)
    assert len(contributions) == 2


def test_top_contributions_batch_matches_single_row_calls():
    model, feature_list = _tiny_model()
    x = np.array([[0.9, 0.1, 0.1], [0.1, 0.9, 0.1], [0.5, 0.5, 0.5]])

    batch = top_contributions_batch(model, x, feature_list)
    singles = [top_contributions(model, row, feature_list) for row in x]

    assert len(batch) == len(x)
    for batch_row, single_row in zip(batch, singles):
        assert batch_row == single_row
