from app.engine.site_matching import HabitationInput, ScoredSiteInput, match_habitations_to_sites

_RAW_ATTRIBUTES = {
    "slopeDegrees": 3.0,
    "distanceToAllWeatherRoadM": 100.0,
    "availableWaterSupplyLpd": 55000.0,
    "existingInfrastructureIndex": 0.8,
}


def _site(site_id: str, lon: float, lat: float, capacity: float) -> ScoredSiteInput:
    return ScoredSiteInput(
        site_id=site_id,
        lon=lon,
        lat=lat,
        area_sqm=60_000.0,
        land_ownership="GOVT",
        raw_attributes=_RAW_ATTRIBUTES,
        hazard_safety_score=1.0,
        effective_capacity=capacity,
    )


def _habitation(
    habitation_id: str, lon: float, lat: float, households: int, bucket: str, rpi: float
) -> HabitationInput:
    return HabitationInput(
        habitation_id=habitation_id,
        lon=lon,
        lat=lat,
        distance_to_livelihood_asset_km=1.0,
        households=households,
        priority_bucket=bucket,
        relocation_priority_index=rpi,
    )


def test_habitation_gets_its_top_ranked_site_when_capacity_allows():
    near_site = _site("near", 76.0, 11.0, capacity=100.0)
    far_site = _site("far", 78.0, 13.0, capacity=100.0)
    habitation = _habitation("hab1", 76.001, 11.001, households=10, bucket="Immediate", rpi=0.9)

    [result] = match_habitations_to_sites([habitation], [near_site, far_site])

    assert result.allocated_site_id == "near"
    assert result.allocated_households == 10
    assert result.ranked_sites[0].site_id == "near"
    assert result.ranked_sites[0].rank == 1


def test_immediate_priority_is_matched_before_shortterm_regardless_of_input_order():
    site = _site("only", 76.0, 11.0, capacity=10.0)
    shortterm = _habitation("hab_short", 76.0, 11.0, households=10, bucket="ShortTerm", rpi=0.99)
    immediate = _habitation("hab_immediate", 76.0, 11.0, households=10, bucket="Immediate", rpi=0.1)

    results = match_habitations_to_sites([shortterm, immediate], [site])
    by_id = {r.habitation_id: r for r in results}

    assert by_id["hab_immediate"].allocated_site_id == "only"
    assert by_id["hab_short"].allocated_site_id is None


def test_within_same_bucket_higher_rpi_is_matched_first():
    site = _site("only", 76.0, 11.0, capacity=10.0)
    low_rpi = _habitation("hab_low", 76.0, 11.0, households=10, bucket="Immediate", rpi=0.3)
    high_rpi = _habitation("hab_high", 76.0, 11.0, households=10, bucket="Immediate", rpi=0.9)

    results = match_habitations_to_sites([low_rpi, high_rpi], [site])
    by_id = {r.habitation_id: r for r in results}

    assert by_id["hab_high"].allocated_site_id == "only"
    assert by_id["hab_low"].allocated_site_id is None


def test_many_to_one_allocation_tracks_remaining_capacity_across_habitations():
    site = _site("shared", 76.0, 11.0, capacity=25.0)
    hab_a = _habitation("hab_a", 76.0, 11.0, households=15, bucket="Immediate", rpi=0.9)
    hab_b = _habitation("hab_b", 76.0, 11.0, households=15, bucket="Immediate", rpi=0.5)

    results = match_habitations_to_sites([hab_a, hab_b], [site])
    by_id = {r.habitation_id: r for r in results}

    assert by_id["hab_a"].allocated_site_id == "shared"
    assert by_id["hab_b"].allocated_site_id is None


def test_habitation_with_no_site_having_enough_capacity_gets_no_allocation():
    site = _site("tiny", 76.0, 11.0, capacity=2.0)
    habitation = _habitation("hab1", 76.0, 11.0, households=50, bucket="Immediate", rpi=0.9)

    [result] = match_habitations_to_sites([habitation], [site])

    assert result.allocated_site_id is None
    assert result.allocated_households == 0
    assert len(result.ranked_sites) == 1


def test_ranked_sites_are_capped_at_five():
    sites = [_site(f"s{i}", 76.0 + i * 0.01, 11.0, capacity=100.0) for i in range(8)]
    habitation = _habitation("hab1", 76.0, 11.0, households=5, bucket="Immediate", rpi=0.9)

    [result] = match_habitations_to_sites([habitation], sites)

    assert len(result.ranked_sites) == 5
