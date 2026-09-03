import numpy as np
import xgboost as xgb

from app.engine.explain import get_explainer, top_contributions


def _tiny_model() -> tuple[xgb.XGBClassifier, list[str]]:
    rng = np.random.default_rng(0)
    feature_list = ["slope", "lithology", "landCover"]
    x = rng.uniform(0, 1, (200, 3))
    # slope drives the label almost entirely -> its SHAP contribution should dominate.
    y = (x[:, 0] > 0.5).astype(int)
    model = xgb.XGBClassifier(max_depth=3, n_estimators=50, eval_metric="logloss", random_state=0)
    model.fit(x, y)
    return model, feature_list


def test_get_explainer_is_cached_per_model_version():
    model, _ = _tiny_model()
    e1 = get_explainer(model, "test-v1")
    e2 = get_explainer(model, "test-v1")
    e3 = get_explainer(model, "test-v2")
    assert e1 is e2
    assert e1 is not e3


def test_top_contributions_returns_signed_ranked_factors():
    model, feature_list = _tiny_model()
    x_row = np.array([0.9, 0.1, 0.1])  # high slope -> should push toward positive/INCREASES_RISK

    contributions = top_contributions(model, "test-v3", x_row, feature_list, top_n=3)

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
    contributions = top_contributions(model, "test-v4", x_row, feature_list, top_n=2)
    assert len(contributions) == 2
