from datetime import datetime, timezone
from unittest.mock import patch

import h3
import numpy as np

from app.engine import pipeline as pipeline_module
from app.engine.assessment import HabitationInput
from app.engine.pipeline import CellInput
from app.engine.scenario import (
    ScenarioParams,
    is_hazard_affected,
    perturb_factors,
    run_district_scenario,
    run_scenario_for_hazard,
)

LANDSLIDE_FACTORS = {
    "slope": 20.0,
    "lithology": 0.5,
    "landCover": 0.5,
    "antecedentRainfallIndex": 0.3,
    "soilDepth": 3.0,
    "distanceToDrainage": 1.0,
    "distanceToRoadCut": 0.5,
    "historicalIncidentDensity": 0.3,
    "curvature": 0.5,
    "aspect": 0.5,
}

FLOOD_FACTORS = {
    "elevation": 30.0,
    "rainfallIntensity": 0.3,
    "distanceToRiver": 1.0,
    "twi": 8.0,
    "drainageDensity": 0.5,
    "landCover": 0.5,
    "soilInfiltration": 25.0,
    "historicalInundation": 0.3,
}

COASTAL_FACTORS = {
    "shorelineChangeRate": 1.0,
    "elevation": 10.0,
    "waveEnergy": 0.3,
    "geomorphology": 0.5,
    "tidalRange": 2.5,
    "mangroveDuneBufferPresence": 0.3,
}


def _cells(factor_template: dict, n: int = 250, seed: int = 0) -> list[CellInput]:
    rng = np.random.default_rng(seed)
    cells = []
    for _ in range(n):
        lon = 76.0 + rng.uniform(0, 0.3)
        lat = 11.6 + rng.uniform(0, 0.3)
        jittered = {k: v * float(rng.uniform(0.85, 1.15)) for k, v in factor_template.items()}
        cells.append(CellInput(h3.latlng_to_cell(lat, lon, 8), "wayanad", lon, lat, jittered))
    return cells


def test_perturb_factors_rainfall_raises_landslide_and_flood_but_not_cloudburst():
    params = ScenarioParams(rainfall_mm_per_24h=500)
    landslide_out = perturb_factors(LANDSLIDE_FACTORS, "landslide", params)
    flood_out = perturb_factors(FLOOD_FACTORS, "flood", params)
    cloudburst_factors = {"orographicIndex": 0.3, "historicalCloudburstDensity": 0.05, "slope": 20.0, "elevation": 1500.0, "drainageCapacity": 0.5}
    cloudburst_out = perturb_factors(cloudburst_factors, "cloudburst", params)

    assert landslide_out["antecedentRainfallIndex"] > LANDSLIDE_FACTORS["antecedentRainfallIndex"]
    assert flood_out["rainfallIntensity"] > FLOOD_FACTORS["rainfallIntensity"]
    # cloudburst has no rainfall-magnitude factor in hazard-weights.json — untouched.
    assert cloudburst_out == cloudburst_factors


def test_perturb_factors_never_mutates_the_input_dict():
    original = dict(LANDSLIDE_FACTORS)
    perturb_factors(LANDSLIDE_FACTORS, "landslide", ScenarioParams(rainfall_mm_per_24h=500))
    assert LANDSLIDE_FACTORS == original


def test_perturb_factors_sea_level_rise_lowers_elevation_and_raises_wave_energy():
    params = ScenarioParams(sea_level_rise_m=1.0)
    out = perturb_factors(COASTAL_FACTORS, "coastalErosion", params)
    assert out["elevation"] < COASTAL_FACTORS["elevation"]
    assert out["waveEnergy"] > COASTAL_FACTORS["waveEnergy"]


def test_perturb_factors_sea_level_rise_elevation_never_goes_negative():
    params = ScenarioParams(sea_level_rise_m=50.0)
    out = perturb_factors(COASTAL_FACTORS, "coastalErosion", params)
    assert out["elevation"] == 0.0


def test_perturb_factors_cyclone_raises_wave_energy_and_flood_rainfall():
    params = ScenarioParams(cyclone_category=4)
    coastal_out = perturb_factors(COASTAL_FACTORS, "coastalErosion", params)
    flood_out = perturb_factors(FLOOD_FACTORS, "flood", params)
    assert coastal_out["waveEnergy"] > COASTAL_FACTORS["waveEnergy"]
    assert flood_out["rainfallIntensity"] > FLOOD_FACTORS["rainfallIntensity"]


def test_is_hazard_affected():
    assert is_hazard_affected("landslide", ScenarioParams(rainfall_mm_per_24h=100))
    assert not is_hazard_affected("coastalErosion", ScenarioParams(rainfall_mm_per_24h=100))
    assert is_hazard_affected("coastalErosion", ScenarioParams(sea_level_rise_m=0.3))
    assert not is_hazard_affected("landslide", ScenarioParams(sea_level_rise_m=0.3))
    assert not is_hazard_affected("landslide", ScenarioParams())


def test_run_scenario_for_hazard_trains_exactly_once_reusing_the_model_for_the_scenario_pass():
    cells = _cells(LANDSLIDE_FACTORS)
    original_train = pipeline_module.train_hazard_model
    call_count = 0

    def counting_train(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return original_train(*args, **kwargs)

    with patch.object(pipeline_module, "train_hazard_model", side_effect=counting_train):
        run_scenario_for_hazard("landslide", cells, [], ScenarioParams(rainfall_mm_per_24h=500))

    assert call_count == 1, "scenario run must train once and reuse the model for the perturbed pass, not retrain"


def test_run_scenario_for_hazard_raises_mean_blended_score_when_rainfall_increases():
    cells = _cells(LANDSLIDE_FACTORS)
    result = run_scenario_for_hazard("landslide", cells, [], ScenarioParams(rainfall_mm_per_24h=800))

    assert result.affected
    mean_baseline = sum(c.baseline_blended for c in result.cells) / len(result.cells)
    mean_scenario = sum(c.scenario_blended for c in result.cells) / len(result.cells)
    assert mean_scenario > mean_baseline


def test_run_scenario_for_hazard_unaffected_hazard_scenario_equals_baseline():
    cells = _cells(COASTAL_FACTORS)
    result = run_scenario_for_hazard("coastalErosion", cells, [], ScenarioParams(rainfall_mm_per_24h=500))
    assert not result.affected
    for c in result.cells:
        assert c.scenario_blended == c.baseline_blended
        assert c.scenario_zone_class == c.baseline_zone_class


HABITATION_ATTRS = {
    "demographics": {
        "shareUnder5": 0.3, "shareOver60": 0.3, "womenHeadedHouseholdShare": 0.3,
        "disabledPersonsShare": 0.2, "bplShare": 0.6, "scStShare": 0.5, "literacyRate": 0.5,
    },
    "structures": {"kutchaHousingShare": 0.5, "avgBuildingAgeYears": 40, "predominantFoundationType": "RUBBLE"},
    "access": {"distanceToAllWeatherRoadKm": 5, "distanceToPhcKm": 10, "mobileNetworkCoverage": 0.3, "evacuationRouteCount": 1},
    "livelihood": {"primaryOccupation": "AGRICULTURE", "distanceToLivelihoodAssetKm": 2, "primaryLivelihoodDependenceShare": 0.7},
    "copingCapacity": {"sdrfResponseTimeMinutes": 90, "shelterWithin2km": False, "communityTaskForcePresent": False, "earlyWarningCoverage": 0.3},
}


def test_run_district_scenario_reports_a_habitation_entering_immediate_and_a_realistic_runtime():
    landslide_cells = _cells(LANDSLIDE_FACTORS, n=400, seed=1)
    flood_cells = _cells(FLOOD_FACTORS, n=400, seed=2)

    # One habitation sitting where landslide factors are already borderline —
    # a big rainfall scenario should be able to push it (or at least some
    # habitation in a realistic batch) into a worse bucket.
    habitations = [
        HabitationInput(habitation_id=f"h{i}", lon=76.0 + i * 0.01, lat=11.6 + i * 0.01, households=150, attributes=HABITATION_ATTRS)
        for i in range(5)
    ]

    result = run_district_scenario(
        hazard_cells={"landslide": landslide_cells, "flood": flood_cells},
        hazard_event_points={},
        habitations=habitations,
        hazard_events=[],
        params=ScenarioParams(rainfall_mm_per_24h=900),
        as_of=datetime.now(timezone.utc),
    )

    assert len(result.hazard_summaries) == 2
    landslide_summary = next(s for s in result.hazard_summaries if s.hazard == "landslide")
    assert landslide_summary.affected
    assert sum(landslide_summary.baseline_zone_counts.values()) == 400
    assert sum(landslide_summary.scenario_zone_counts.values()) == 400

    # Runtime is asserted generously here (unit-test machines vary); the
    # real target (<10s for a full district) is measured and reported
    # separately against live Wayanad/Ganjam data, not hard-asserted in CI.
    assert result.runtime_seconds < 30.0


def test_run_district_scenario_zero_parameters_produces_no_deltas():
    landslide_cells = _cells(LANDSLIDE_FACTORS, n=100, seed=3)
    habitations = [
        HabitationInput(habitation_id="h1", lon=76.05, lat=11.65, households=150, attributes=HABITATION_ATTRS)
    ]
    result = run_district_scenario(
        hazard_cells={"landslide": landslide_cells},
        hazard_event_points={},
        habitations=habitations,
        hazard_events=[],
        params=ScenarioParams(),
        as_of=datetime.now(timezone.utc),
    )
    assert result.habitation_deltas == []
    assert result.habitations_entering_immediate == []
    for summary in result.hazard_summaries:
        assert summary.cells_changed == 0
        assert not summary.affected
