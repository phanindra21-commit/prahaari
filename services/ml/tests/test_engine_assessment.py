from shapely.geometry import Polygon

from app.engine.assessment import assess_habitation

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


def test_habitation_fully_inside_a_red_zone_gets_a_priority_bucket():
    result = assess_habitation(
        habitation_id="h1",
        lon=76.0,
        lat=11.6,
        households=200,
        habitation_attributes=HABITATION_ATTRS,
        hazard_zone_geoms={"landslide": {"Red": RED_ZONE}},
        hazard_zone_scores={"landslide": {"Red": 0.85}},
    )
    assert result.overall_zone_class == "Red"
    assert result.relocation_priority_index is not None
    assert result.priority_bucket is not None
    assert len(result.explanation) == 5
    assert result.hazard_exposure[0].hazard_score == 0.85
    assert result.hazard_exposure[0].exposure > 0.9


def test_habitation_fully_inside_a_green_zone_is_assessed_but_not_bucketed():
    result = assess_habitation(
        habitation_id="h2",
        lon=76.3,
        lat=11.6,
        households=200,
        habitation_attributes=HABITATION_ATTRS,
        hazard_zone_geoms={"landslide": {"Green": GREEN_ZONE}},
        hazard_zone_scores={"landslide": {"Green": 0.1}},
    )
    assert result.overall_zone_class == "Green"
    assert result.relocation_priority_index is None
    assert result.priority_bucket is None
    assert result.explanation == []
    # Still "recorded as assessed": VI, coping capacity, and risk are computed regardless.
    assert 0.0 <= result.vulnerability_index <= 1.0
    assert 0.0 <= result.composite_risk_score <= 1.0


def test_governing_hazard_is_the_worst_across_multiple_hazards():
    result = assess_habitation(
        habitation_id="h3",
        lon=76.0,
        lat=11.6,
        households=200,
        habitation_attributes=HABITATION_ATTRS,
        hazard_zone_geoms={
            "landslide": {"Red": RED_ZONE},
            "flood": {"Green": GREEN_ZONE},
        },
        hazard_zone_scores={
            "landslide": {"Red": 0.85},
            "flood": {"Green": 0.05},
        },
    )
    assert result.governing_hazard == "landslide"
    assert len(result.hazard_exposure) == 2


def test_two_orange_hazards_escalate_the_overall_zone_class_to_red():
    orange_zone = Polygon([(75.9, 11.5), (76.1, 11.5), (76.1, 11.7), (75.9, 11.7)])
    result = assess_habitation(
        habitation_id="h4",
        lon=76.0,
        lat=11.6,
        households=200,
        habitation_attributes=HABITATION_ATTRS,
        hazard_zone_geoms={
            "landslide": {"Orange": orange_zone},
            "flood": {"Orange": orange_zone},
        },
        hazard_zone_scores={
            "landslide": {"Orange": 0.55},
            "flood": {"Orange": 0.6},
        },
    )
    assert result.overall_zone_class == "Red"
    assert result.priority_bucket is not None
