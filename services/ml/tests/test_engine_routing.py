import h3

from app.engine.routing import GridCellForRouting, compute_route

_CENTER = h3.latlng_to_cell(11.7, 76.1, 8)


def _build_disk(k: int = 6) -> dict[str, tuple[int, int]]:
    """Every cell within k rings of _CENTER, keyed by its local (i, j) grid
    coordinate — a real H3 patch we can address like a simple 2D grid."""
    disk = h3.grid_disk(_CENTER, k)
    return {cell: h3.cell_to_local_ij(_CENTER, cell) for cell in disk}


def _cells_all_green() -> tuple[list[GridCellForRouting], dict[tuple[int, int], str]]:
    by_ij = _build_disk()
    ij_to_cell = {ij: cell for cell, ij in by_ij.items()}
    cells = []
    for cell, (i, j) in by_ij.items():
        lat, lon = h3.cell_to_latlng(cell)
        cells.append(GridCellForRouting(h3_index=cell, lon=lon, lat=lat, zone_class="Green", score=0.1))
    return cells, ij_to_cell


def test_no_grid_cells_returns_none():
    assert compute_route(76.0, 11.0, 76.2, 11.2, []) is None


def test_all_green_route_hugs_the_direct_line_and_scores_near_perfect_safety():
    cells, ij_to_cell = _cells_all_green()
    origin_cell = ij_to_cell[(74, 207)]
    dest_cell = ij_to_cell[(86, 207)]
    origin_lat, origin_lon = h3.cell_to_latlng(origin_cell)
    dest_lat, dest_lon = h3.cell_to_latlng(dest_cell)

    result = compute_route(origin_lon, origin_lat, dest_lon, dest_lat, cells)

    assert result is not None
    assert result.route_safety_score == 1.0
    assert all(e.zone_class == "Green" for e in result.route_exposure)
    # An all-Green grid has no reason to detour meaningfully off the direct line.
    assert result.detour_ratio < 1.15


def test_a_red_wall_forces_a_detour_through_the_gap_and_avoids_red():
    cells, ij_to_cell = _cells_all_green()
    by_index = {c.h3_index: c for c in cells}

    # A near-impassable wall at i=80 spanning every j except one gap —
    # forces the route around it rather than straight through.
    gap_j = 213
    wall_cells = [ij for ij in ij_to_cell if ij[0] == 80 and ij[1] != gap_j]
    assert len(wall_cells) > 5, "test fixture sanity check: expected a real wall, not a sliver"
    for ij in wall_cells:
        by_index[ij_to_cell[ij]].zone_class = "Red"
        by_index[ij_to_cell[ij]].score = 0.95

    origin_cell = ij_to_cell[(74, 207)]
    dest_cell = ij_to_cell[(86, 207)]
    origin_lat, origin_lon = h3.cell_to_latlng(origin_cell)
    dest_lat, dest_lon = h3.cell_to_latlng(dest_cell)

    result = compute_route(origin_lon, origin_lat, dest_lon, dest_lat, list(by_index.values()))

    assert result is not None
    # The safest route must not cross the wall: no Red in its exposure.
    assert all(e.zone_class != "Red" for e in result.route_exposure)
    # Going around a wall is strictly longer than going straight through it.
    assert result.detour_ratio > 1.05
    assert result.route_safety_score == 1.0
    # The direct line, unlike the routed path, plows straight through the wall.
    assert any(e.zone_class == "Red" for e in result.direct_exposure)


def test_origin_and_destination_in_the_same_cell_is_a_trivial_route():
    cells, ij_to_cell = _cells_all_green()
    lat, lon = h3.cell_to_latlng(ij_to_cell[(80, 207)])

    result = compute_route(lon, lat, lon + 0.0001, lat + 0.0001, cells)

    assert result is not None
    assert result.detour_ratio == 1.0
    assert result.route_length_km == result.direct_length_km


def test_route_safety_score_matches_the_weighted_km_average():
    cells, ij_to_cell = _cells_all_green()
    by_index = {c.h3_index: c for c in cells}
    # An Orange wall spanning the ENTIRE width (no Green gap, unlike the
    # Red-wall test above) — every possible route must cross at least one
    # Orange cell, so the resulting safety score is a genuine weighted
    # average strictly between 0 and 1, not 1.0 from A* simply detouring
    # around a single avoidable costly cell (which is what a one-cell
    # Orange marker, with a cheap detour available, would correctly do).
    wall_cells = [ij for ij in ij_to_cell if ij[0] == 80]
    assert len(wall_cells) > 5, "test fixture sanity check: expected a full-width wall"
    for ij in wall_cells:
        by_index[ij_to_cell[ij]].zone_class = "Orange"

    origin_cell = ij_to_cell[(74, 207)]
    dest_cell = ij_to_cell[(86, 207)]
    origin_lat, origin_lon = h3.cell_to_latlng(origin_cell)
    dest_lat, dest_lon = h3.cell_to_latlng(dest_cell)

    result = compute_route(origin_lon, origin_lat, dest_lon, dest_lat, list(by_index.values()))

    assert result is not None
    assert 0.0 < result.route_safety_score < 1.0
    assert any(e.zone_class == "Orange" for e in result.route_exposure)
    total_km = sum(e.km for e in result.route_exposure)
    assert abs(total_km - result.route_length_km) < 1e-6
