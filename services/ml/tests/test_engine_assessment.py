from datetime import datetime, timedelta, timezone

from shapely.geometry import Polygon

from app.engine.assessment import HabitationInput, assess_habitations_batch
from app.engine.disaster_history import HazardEventPoint

HABITATION_ATTRS = {
    "demographics": {
        "shareUnder5": 0.3, "shareOver60": 0.3, "womenHeadedHouseholdShare": 0.3,
        "disabledPersonsShare": 0.2, "bplShare": 0.6, "scStShare": 0.5, "literacyRate": 0.5,
    },
    "structures": {
        "kutchaHousingShare": 0.5, "avgBuildingAgeYears": 40,
        "predominantFoundationType": "RUBBLE",
    },
    "access": {
        "distanceToAllWeatherRoadKm": 5, "distanceToPhcKm": 10,
        "mobileNetworkCoverage": 0.3, "evacuationRouteCount": 1,
    },
    "livelihood": {
        "primaryOccupation": "AGRICULTURE", "distanceToLivelihoodAssetKm": 2,
        "primaryLivelihoodDependenceShare": 0.7,
    },
    "copingCapacity": {
        "sdrfResponseTimeMinutes": 90, "shelterWithin2km": False,
        "communityTaskForcePresent": False, "earlyWarningCoverage": 0.3,
    },
}

RED_ZONE = Polygon([(75.9, 11.5), (76.1, 11.5), (76.1, 11.7), (75.9, 11.7)])
GREEN_ZONE = Polygon([(76.2, 11.5), (76.4, 11.5), (76.4, 11.7), (76.2, 11.7)])


def _habitation(habitation_id: str, lon: float, lat: float, **overrides) -> HabitationInput:
    return HabitationInput(
        habitation_id=habitation_id, lon=lon, lat=lat, households=200,
        attributes={**HABITATION_ATTRS, **overrides},
    )


def test_habitation_fully_inside_a_red_zone_gets_a_priority_bucket():
    results = assess_habitations_batch(
        [_habitation("h1", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
    )
    result = results[0]
    assert result.overall_zone_class == "Red"
    assert result.relocation_priority_index is not None
    assert result.priority_bucket is not None
    assert len(result.explanation) == 5
    assert result.hazard_exposure[0].hazard_score == 0.85
    assert result.hazard_exposure[0].exposure > 0.9


def test_a_lone_red_zone_habitation_is_the_most_urgent_in_its_own_batch():
    # The whole point of the normalize(Risk) fix: assessed alone, a
    # Red-zone habitation is trivially the most urgent habitation in its
    # batch, so normalized risk = 1.0 and RPI = 0.55*1.0 + 0.45*VI, which
    # crosses the Immediate threshold even for a moderate VI. This is the
    # exact shape of the Chooralmala/Mundakkai case.
    results = assess_habitations_batch(
        [_habitation("h1", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
    )
    result = results[0]
    assert result.relocation_priority_index == 0.55 * 1.0 + 0.45 * result.vulnerability_index
    assert result.priority_bucket == "Immediate"


def test_habitation_fully_inside_a_green_zone_is_assessed_but_not_bucketed():
    results = assess_habitations_batch(
        [_habitation("h2", 76.3, 11.6)],
        hazard_zone_geoms={"landslide": {"Green": GREEN_ZONE}},
        hazard_zone_scores={"landslide": {"Green": 0.1}},
    )
    result = results[0]
    assert result.overall_zone_class == "Green"
    assert result.relocation_priority_index is None
    assert result.priority_bucket is None
    assert result.explanation == []
    # Still "recorded as assessed": VI, coping capacity, and risk are computed regardless.
    assert 0.0 <= result.vulnerability_index <= 1.0
    assert 0.0 <= result.composite_risk_score <= 1.0


def test_governing_hazard_is_the_worst_across_multiple_hazards():
    results = assess_habitations_batch(
        [_habitation("h3", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}, "flood": {"Green": GREEN_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}, "flood": {"Green": 0.05}},
    )
    result = results[0]
    assert result.governing_hazard == "landslide"
    assert len(result.hazard_exposure) == 2


def test_two_orange_hazards_escalate_the_overall_zone_class_to_red():
    orange_zone = Polygon([(75.9, 11.5), (76.1, 11.5), (76.1, 11.7), (75.9, 11.7)])
    results = assess_habitations_batch(
        [_habitation("h4", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Orange": orange_zone}, "flood": {"Orange": orange_zone}},
        hazard_zone_scores={"landslide": {"Orange": 0.55}, "flood": {"Orange": 0.6}},
    )
    result = results[0]
    assert result.overall_zone_class == "Red"
    assert result.priority_bucket is not None


def test_normalize_risk_ranks_habitations_relative_to_the_batch():
    # Two Red-zone habitations, identical attributes, different hazard
    # scores: the higher-risk one must get normalized_risk=1.0 (and thus
    # the higher RPI); the lower-risk one gets 0.0 (min of the batch).
    results = assess_habitations_batch(
        [_habitation("low", 76.0, 11.6), _habitation("high", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.72}},  # same zone/score for both cells... see below
    )
    # Both habitations share the same footprint/zone here, so give them
    # different governing risk via different VI instead (still exercises
    # the same normalize_risk ranking logic end-to-end).
    low_vi_habitation = _habitation("low2", 76.0, 11.6, demographics={
        "shareUnder5": 0.05, "shareOver60": 0.05, "womenHeadedHouseholdShare": 0.05,
        "disabledPersonsShare": 0.02, "bplShare": 0.05, "scStShare": 0.05, "literacyRate": 0.95,
    })
    high_vi_habitation = _habitation("high2", 76.0, 11.6, demographics={
        "shareUnder5": 0.9, "shareOver60": 0.9, "womenHeadedHouseholdShare": 0.9,
        "disabledPersonsShare": 0.9, "bplShare": 0.95, "scStShare": 0.95, "literacyRate": 0.05,
    })
    results2 = assess_habitations_batch(
        [low_vi_habitation, high_vi_habitation],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.9}},
    )
    by_id = {r.habitation_id: r for r in results2}
    assert by_id["low2"].composite_risk_score < by_id["high2"].composite_risk_score
    assert by_id["high2"].relocation_priority_index > by_id["low2"].relocation_priority_index
    # The batch's own highest-risk habitation is normalized to exactly 1.0.
    assert by_id["high2"].relocation_priority_index == 0.55 * 1.0 + 0.45 * by_id["high2"].vulnerability_index
    assert results[0].habitation_id == "low"  # sanity: batch ordering preserved


def test_a_recorded_hazard_event_nearby_elevates_exposure_and_risk():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    plain = assess_habitations_batch(
        [_habitation("plain", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
        hazard_events=[],
        as_of=now,
    )[0]
    with_history = assess_habitations_batch(
        [_habitation("history", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
        hazard_events=[HazardEventPoint(hazard_type="landslide", lon=76.0, lat=11.6, date=now - timedelta(days=30))],
        as_of=now,
    )[0]
    assert with_history.hazard_exposure[0].disaster_history_boost > 0
    assert with_history.hazard_exposure[0].exposure >= plain.hazard_exposure[0].exposure
    assert with_history.composite_risk_score >= plain.composite_risk_score


def test_hazard_event_of_a_different_hazard_type_does_not_boost_this_hazard():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    results = assess_habitations_batch(
        [_habitation("h5", 76.0, 11.6)],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
        hazard_events=[HazardEventPoint(hazard_type="flood", lon=76.0, lat=11.6, date=now - timedelta(days=30))],
        as_of=now,
    )
    assert results[0].hazard_exposure[0].disaster_history_boost == 0.0


def test_yellow_green_habitations_do_not_affect_red_orange_normalization():
    # A Green habitation's near-zero risk must not stretch the Red/Orange
    # normalization range — normalize_risk's population is the Red/Orange
    # subset only.
    red_habitation = _habitation("red1", 76.0, 11.6)
    green_habitation = _habitation("green1", 76.3, 11.6)
    results = assess_habitations_batch(
        [red_habitation, green_habitation],
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE, "Green": GREEN_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85, "Green": 0.05}},
    )
    by_id = {r.habitation_id: r for r in results}
    assert by_id["green1"].priority_bucket is None
    # Alone among Red/Orange habitations -> normalized to 1.0, same as the single-habitation case.
    assert by_id["red1"].relocation_priority_index == 0.55 * 1.0 + 0.45 * by_id["red1"].vulnerability_index
