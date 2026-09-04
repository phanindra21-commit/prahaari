from app.engine.compound_hazard import detect_compound_hazard


def test_no_compound_when_only_trigger_is_red():
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": 0.8, "landslide": 0.2},
        zone_class_by_hazard={"cloudburst": "Red", "landslide": "Yellow"},
    )
    assert result is None


def test_no_compound_when_only_mechanism_is_red():
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": 0.2, "landslide": 0.8},
        zone_class_by_hazard={"cloudburst": "Yellow", "landslide": "Red"},
    )
    assert result is None


def test_no_compound_when_neither_hazard_present():
    result = detect_compound_hazard(
        risk_by_hazard={"flood": 0.8},
        zone_class_by_hazard={"flood": "Red"},
    )
    assert result is None


def test_compound_detected_when_both_red():
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": 0.28, "landslide": 0.27, "flood": 0.05},
        zone_class_by_hazard={"cloudburst": "Red", "landslide": "Red", "flood": "Yellow"},
    )
    assert result is not None
    assert result.trigger == "cloudburst"
    assert result.mechanism == "landslide"
    assert result.trigger_risk == 0.28
    assert result.mechanism_risk == 0.27


def test_compound_detected_when_both_orange():
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": 0.5, "landslide": 0.4},
        zone_class_by_hazard={"cloudburst": "Orange", "landslide": "Orange"},
    )
    assert result is not None


def test_compound_risk_is_probabilistic_or_and_exceeds_either_alone():
    trigger_risk, mechanism_risk = 0.28, 0.27
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": trigger_risk, "landslide": mechanism_risk},
        zone_class_by_hazard={"cloudburst": "Red", "landslide": "Red"},
    )
    expected = 1.0 - (1.0 - trigger_risk) * (1.0 - mechanism_risk)
    assert result.compound_risk == expected
    assert result.compound_risk > trigger_risk
    assert result.compound_risk > mechanism_risk


def test_compound_risk_stays_within_0_1():
    result = detect_compound_hazard(
        risk_by_hazard={"cloudburst": 0.95, "landslide": 0.9},
        zone_class_by_hazard={"cloudburst": "Red", "landslide": "Red"},
    )
    assert 0.0 <= result.compound_risk <= 1.0
