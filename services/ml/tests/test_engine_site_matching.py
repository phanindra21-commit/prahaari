import h3

from app.engine.routing import GridCellForRouting
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


def _grid_around(center_lat: float, center_lon: float, k: int = 6):
    center = h3.latlng_to_cell(center_lat, center_lon, 8)
    disk = h3.grid_disk(center, k)
    by_ij = {cell: h3.cell_to_local_ij(center, cell) for cell in disk}
    ij_to_cell = {ij: cell for cell, ij in by_ij.items()}
    cells = [
        GridCellForRouting(h3_index=cell, lon=lon, lat=lat, zone_class="Green", score=0.1)
        for cell, (lat, lon) in ((c, h3.cell_to_latlng(c)) for c in disk)
    ]
    return cells, ij_to_cell


def test_route_safety_can_overtake_a_marginally_better_but_red_blocked_site():
    """Step 10 Part 3C: the documented post-AHP adjustment can flip the
    ranked order when suitability alone is close — a site that wins on
    pure AHP suitability is outranked once its only approach is shown to
    cross a solid Red wall, by a nearly-as-suitable site with a clean
    corridor."""
    cells, ij_to_cell = _grid_around(11.7, 76.1)
    by_index = {c.h3_index: c for c in cells}

    hab_lat, hab_lon = h3.cell_to_latlng(ij_to_cell[(80, 207)])
    east_lat, east_lon = h3.cell_to_latlng(ij_to_cell[(86, 207)])
    west_lat, west_lon = h3.cell_to_latlng(ij_to_cell[(74, 207)])

    east_site = _site("east", east_lon, east_lat, capacity=100.0)
    west_site = _site("west", west_lon, west_lat, capacity=100.0)
    habitation = _habitation("hab1", hab_lon, hab_lat, households=10, bucket="Immediate", rpi=0.9)

    # Whichever of the two wins on pure AHP suitability (the H3 hex grid
    # is not perfectly isotropic, so "east" vs "west" from the habitation
    # are not guaranteed identical distances) becomes "winner"; a full-
    # width Red wall is then placed directly behind IT, so the test always
    # exercises the "adjustment overtakes the pure-AHP winner" case
    # regardless of which side naturally scores higher.
    [unrouted] = match_habitations_to_sites([habitation], [east_site, west_site])
    winner_id = unrouted.ranked_sites[0].site_id
    winner_i, loser_i = (86, 74) if winner_id == "east" else (74, 86)
    wall_i = 83 if winner_i == 86 else 77

    for ij, cell in ij_to_cell.items():
        if ij[0] == wall_i:
            by_index[cell].zone_class = "Red"

    [routed] = match_habitations_to_sites([habitation], [east_site, west_site], list(by_index.values()))

    loser_id = "west" if winner_id == "east" else "east"
    assert routed.ranked_sites[0].site_id == loser_id
    assert routed.ranked_sites[0].route_safety_score == 1.0
    winner_entry = next(r for r in routed.ranked_sites if r.site_id == winner_id)
    assert winner_entry.route_safety_score is not None
    assert winner_entry.route_safety_score < 1.0
    # The pure AHP suitability score itself must be untouched by the adjustment.
    assert winner_entry.suitability_score == unrouted.ranked_sites[0].suitability_score


def test_no_grid_cells_leaves_ranking_and_route_fields_exactly_as_before():
    site_a = _site("a", 76.0, 11.0, capacity=100.0)
    site_b = _site("b", 76.5, 11.5, capacity=100.0)
    habitation = _habitation("hab1", 76.001, 11.001, households=10, bucket="Immediate", rpi=0.9)

    [with_none] = match_habitations_to_sites([habitation], [site_a, site_b], None)
    [without_arg] = match_habitations_to_sites([habitation], [site_a, site_b])

    assert [r.site_id for r in with_none.ranked_sites] == [r.site_id for r in without_arg.ranked_sites]
    assert all(r.route is None and r.route_safety_score is None for r in with_none.ranked_sites)


def test_ranked_sites_are_capped_at_five():
    sites = [_site(f"s{i}", 76.0 + i * 0.01, 11.0, capacity=100.0) for i in range(8)]
    habitation = _habitation("hab1", 76.0, 11.0, households=5, bucket="Immediate", rpi=0.9)

    [result] = match_habitations_to_sites([habitation], sites)

    assert len(result.ranked_sites) == 5
