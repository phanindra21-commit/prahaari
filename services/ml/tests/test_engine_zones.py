import h3

from app.engine.zones import (
    aggregate_multi_hazard,
    classify_zone,
    dissolve_zone_class,
)


# --- classify_zone: hand-computed against zone-thresholds.json.perHazard.landslide (red=0.70, orange=0.50, yellow=0.25) ---


def test_classify_zone_red_boundary_is_inclusive():
    assert classify_zone(0.70, "landslide") == "Red"


def test_classify_zone_just_below_red_is_orange():
    assert classify_zone(0.69999, "landslide") == "Orange"


def test_classify_zone_orange_boundary_is_inclusive():
    assert classify_zone(0.50, "landslide") == "Orange"


def test_classify_zone_just_below_orange_is_yellow():
    assert classify_zone(0.49999, "landslide") == "Yellow"


def test_classify_zone_yellow_boundary_is_inclusive():
    assert classify_zone(0.25, "landslide") == "Yellow"


def test_classify_zone_below_yellow_is_green():
    assert classify_zone(0.1, "landslide") == "Green"


def test_classify_zone_uses_the_hazard_specific_thresholds():
    # flood: red=0.75, orange=0.55, yellow=0.30 — stricter (higher) than landslide's.
    assert classify_zone(0.70, "flood") == "Orange"
    assert classify_zone(0.75, "flood") == "Red"


# --- dissolve_zone_class ---


def test_dissolve_adjacent_cells_produces_a_single_contiguous_polygon():
    center = h3.latlng_to_cell(11.7, 76.1, 8)
    neighbor = next(iter(h3.grid_ring(center, 1)))
    dissolved, simplified = dissolve_zone_class([center, neighbor])
    assert dissolved.geom_type == "Polygon"
    assert simplified.geom_type == "Polygon"
    assert simplified.is_valid


def test_dissolve_distant_cells_produces_a_multipolygon():
    a = h3.latlng_to_cell(11.7, 76.1, 8)
    far = h3.latlng_to_cell(19.0, 84.6, 8)  # Ganjam, nowhere near Wayanad
    dissolved, _ = dissolve_zone_class([a, far])
    assert dissolved.geom_type == "MultiPolygon"
    assert len(dissolved.geoms) == 2


def test_dissolve_area_grows_with_more_contiguous_cells():
    center = h3.latlng_to_cell(11.7, 76.1, 8)
    ring = list(h3.grid_ring(center, 1))
    single, _ = dissolve_zone_class([center])
    seven, _ = dissolve_zone_class([center, *ring])
    assert seven.area > single.area


# --- aggregate_multi_hazard: both rules from METHODOLOGY §1.3 / zone-thresholds.json ---


def test_aggregate_worst_class_wins_with_no_escalation_trigger():
    assert aggregate_multi_hazard({"landslide": "Orange", "flood": "Yellow"}) == "Orange"
    assert aggregate_multi_hazard({"landslide": "Red", "flood": "Green"}) == "Red"
    assert aggregate_multi_hazard({"landslide": "Green", "flood": "Green"}) == "Green"


def test_aggregate_two_orange_hazards_escalates_to_red():
    assert aggregate_multi_hazard({"landslide": "Orange", "flood": "Orange"}) == "Red"


def test_aggregate_two_orange_hazards_does_not_downgrade_an_existing_red():
    assert aggregate_multi_hazard({"landslide": "Red", "flood": "Orange", "cloudburst": "Orange"}) == "Red"


def test_aggregate_single_orange_does_not_escalate():
    assert aggregate_multi_hazard({"landslide": "Orange", "flood": "Yellow", "cloudburst": "Green"}) == "Orange"


def test_aggregate_empty_defaults_to_green():
    assert aggregate_multi_hazard({}) == "Green"
