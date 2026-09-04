from app.engine.capacity import compute_carrying_capacity

_ABUNDANT_ATTRIBUTES = {
    "availableWaterSupplyLpd": 1_000_000.0,
    "nearbySchoolSpareCapacitySeats": 10_000.0,
    "nearbyHealthFacilitySpareCapacityPopulation": 1_000_000.0,
    "distanceToAllWeatherRoadM": 100.0,
}


def test_binding_constraint_is_whichever_domain_yields_the_minimum():
    attrs = {**_ABUNDANT_ATTRIBUTES, "availableWaterSupplyLpd": 1000.0}
    result = compute_carrying_capacity(attrs, area_sqm=1_000_000.0, state="Kerala", terrain_tier="HILLY_TRIBAL")
    assert result.binding_constraint == "WATER"
    assert result.effective_capacity == result.by_water
    assert result.effective_capacity == min(
        result.by_land, result.by_water, result.by_education, result.by_health, result.by_access
    )


def test_water_capacity_uses_55_lpcd_and_state_household_size():
    attrs = {**_ABUNDANT_ATTRIBUTES, "availableWaterSupplyLpd": 55 * 4.3 * 10}
    result = compute_carrying_capacity(attrs, area_sqm=1_000_000.0, state="Kerala", terrain_tier="HILLY_TRIBAL")
    assert result.by_water == 10.0


def test_land_capacity_uses_150_sqm_effective_per_household():
    result = compute_carrying_capacity(
        _ABUNDANT_ATTRIBUTES, area_sqm=1500.0, state="Kerala", terrain_tier="HILLY_TRIBAL"
    )
    assert result.by_land == 10.0


def test_health_capacity_is_capped_by_the_tier_specific_facility_norm():
    # Spare capacity here (1,000,000) vastly exceeds either tier's PHC
    # norm, so both results are pinned to their norm-derived ceiling —
    # Wayanad's smaller hilly-tribal PHC norm (20,000) caps out at fewer
    # households per facility than Ganjam's plains norm (30,000).
    hilly = compute_carrying_capacity(
        _ABUNDANT_ATTRIBUTES, area_sqm=1_000_000.0, state="Kerala", terrain_tier="HILLY_TRIBAL"
    )
    plains = compute_carrying_capacity(
        _ABUNDANT_ATTRIBUTES, area_sqm=1_000_000.0, state="Odisha", terrain_tier="PLAINS"
    )
    assert hilly.by_health != plains.by_health
    assert hilly.by_health < plains.by_health


def test_health_capacity_uses_spare_capacity_when_well_under_the_ceiling():
    attrs = {**_ABUNDANT_ATTRIBUTES, "nearbyHealthFacilitySpareCapacityPopulation": 1800.0}
    result = compute_carrying_capacity(attrs, area_sqm=1_000_000.0, state="Kerala", terrain_tier="HILLY_TRIBAL")
    assert result.by_health == 1800.0 / 4.3


def test_access_capacity_is_zero_when_beyond_all_weather_road_distance():
    attrs = {**_ABUNDANT_ATTRIBUTES, "distanceToAllWeatherRoadM": 5000.0}
    result = compute_carrying_capacity(attrs, area_sqm=1_000_000.0, state="Kerala", terrain_tier="HILLY_TRIBAL")
    assert result.by_access == 0.0
    assert result.binding_constraint == "ACCESS"


def test_unknown_state_falls_back_to_default_household_size():
    result = compute_carrying_capacity(
        _ABUNDANT_ATTRIBUTES, area_sqm=1_000_000.0, state="Unknown State", terrain_tier="PLAINS"
    )
    assert result.by_water > 0.0
