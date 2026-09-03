"""Unit tests for app.engine.reclassify / app.engine.overlay against
hand-computed values, using the real committed
packages/shared/src/config/{hazard-weights,factor-reclassification}.json.
"""

import pytest

from app.engine.reclassify import reclassify_value, reclassify_cell
from app.engine.overlay import overlay_score


def test_reclassify_direct_factor_middle_bucket():
    # landslide.slope breakpoints: [10,20,30,40,null] -> ratings [1,2,3,4,5], DIRECT
    assert reclassify_value(25, "landslide", "slope") == 3


def test_reclassify_direct_factor_boundary_is_inclusive():
    # exactly 10 falls in the first bucket (raw_value <= bp.max)
    assert reclassify_value(10, "landslide", "slope") == 1
    assert reclassify_value(10.0001, "landslide", "slope") == 2


def test_reclassify_direct_factor_top_bucket_is_unbounded():
    assert reclassify_value(1000, "landslide", "slope") == 5


def test_reclassify_inverse_factor_flips_the_table_rating():
    # landslide.landCover breakpoints: [.2,.4,.6,.8,null] -> table ratings [1..5], INVERSE
    # raw 0.7 -> table rating 4 -> susceptibility 6 - 4 = 2
    assert reclassify_value(0.7, "landslide", "landCover") == 2
    # raw 0.1 -> table rating 1 (safest raw value: high forest cover) -> susceptibility 6 - 1 = 5
    assert reclassify_value(0.1, "landslide", "landCover") == 5


def test_reclassify_cell_applies_every_factor():
    factors = {"slope": 25, "landCover": 0.7}
    assert reclassify_cell(factors, "landslide") == {"slope": 3, "landCover": 2}


def test_overlay_score_matches_hand_computed_lsi():
    # Hand-computed against hazard-weights.json.hazards.landslide.factors and
    # factor-reclassification.json.hazards.landslide (see the derivation in
    # the commit message / PR description — reproduced here for the reviewer):
    #   slope=25                      -> R=3 (DIRECT)  W=0.20 -> 0.60
    #   lithology=0.5                 -> R=3 (DIRECT)  W=0.16 -> 0.48
    #   landCover=0.7                 -> R=2 (INVERSE) W=0.13 -> 0.26
    #   antecedentRainfallIndex=0.9   -> R=5 (DIRECT)  W=0.13 -> 0.65
    #   soilDepth=2                   -> R=3 (DIRECT)  W=0.10 -> 0.30
    #   distanceToDrainage=0.25       -> R=4 (INVERSE) W=0.09 -> 0.36
    #   distanceToRoadCut=0.4         -> R=2 (INVERSE) W=0.08 -> 0.16
    #   historicalIncidentDensity=0.1 -> R=1 (DIRECT)  W=0.06 -> 0.06
    #   curvature=0.9                 -> R=5 (DIRECT)  W=0.03 -> 0.15
    #   aspect=0.5                    -> R=3 (DIRECT)  W=0.02 -> 0.06
    # LSI = 0.60+0.48+0.26+0.65+0.30+0.36+0.16+0.06+0.15+0.06 = 3.08
    # normalized = (3.08 - 1) / 4 = 0.52
    factors = {
        "slope": 25,
        "lithology": 0.5,
        "landCover": 0.7,
        "antecedentRainfallIndex": 0.9,
        "soilDepth": 2,
        "distanceToDrainage": 0.25,
        "distanceToRoadCut": 0.4,
        "historicalIncidentDensity": 0.1,
        "curvature": 0.9,
        "aspect": 0.5,
    }
    assert overlay_score(factors, "landslide") == pytest.approx(0.52)


def test_overlay_score_all_factors_at_minimum_rating_gives_zero():
    # Every factor at the safest raw value -> every rating clamps to 1 -> LSI=1 -> normalized=0.
    factors = {
        "slope": 0,
        "lithology": 0,
        "landCover": 1.0,  # INVERSE: max raw value -> table rating 5 -> susceptibility 1
        "antecedentRainfallIndex": 0,
        "soilDepth": 0,
        "distanceToDrainage": 10,  # INVERSE: far from drainage -> table rating 5 -> susceptibility 1
        "distanceToRoadCut": 10,
        "historicalIncidentDensity": 0,
        "curvature": 0,
        "aspect": 0,
    }
    assert overlay_score(factors, "landslide") == pytest.approx(0.0)


def test_overlay_score_all_factors_at_maximum_rating_gives_one():
    factors = {
        "slope": 1000,
        "lithology": 1.0,
        "landCover": 0.0,  # INVERSE: min raw value -> table rating 1 -> susceptibility 5
        "antecedentRainfallIndex": 1.0,
        "soilDepth": 1000,
        "distanceToDrainage": 0,
        "distanceToRoadCut": 0,
        "historicalIncidentDensity": 1.0,
        "curvature": 1.0,
        "aspect": 1.0,
    }
    assert overlay_score(factors, "landslide") == pytest.approx(1.0)
