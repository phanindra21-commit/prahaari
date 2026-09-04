from datetime import datetime, timedelta, timezone

import pytest

from app.config_loader import DISASTER_HISTORY
from app.engine.disaster_history import HazardEventPoint, compute_disaster_history_boost

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _event(hazard_type: str, lon: float, lat: float, years_ago: float) -> HazardEventPoint:
    return HazardEventPoint(hazard_type=hazard_type, lon=lon, lat=lat, date=NOW - timedelta(days=years_ago * 365.25))


def test_no_events_gives_zero_boost():
    assert compute_disaster_history_boost(76.086, 11.510, "landslide", [], NOW) == 0.0


def test_recent_event_at_the_same_point_gives_close_to_max_boost():
    events = [_event("landslide", 76.086, 11.510, years_ago=0.01)]
    boost = compute_disaster_history_boost(76.086, 11.510, "landslide", events, NOW)
    assert boost == pytest.approx(DISASTER_HISTORY["maxBoost"], rel=0.02)


def test_event_beyond_influence_radius_gives_zero_boost():
    # ~1 degree of longitude at this latitude is >100km, well past influenceRadiusKm.
    events = [_event("landslide", 76.086 + 1.0, 11.510, years_ago=0.01)]
    assert compute_disaster_history_boost(76.086, 11.510, "landslide", events, NOW) == 0.0


def test_boost_decays_with_distance():
    near = compute_disaster_history_boost(76.086, 11.510, "landslide", [_event("landslide", 76.086, 11.510, 0.01)], NOW)
    far = compute_disaster_history_boost(76.10, 11.510, "landslide", [_event("landslide", 76.086, 11.510, 0.01)], NOW)
    assert far < near


def test_boost_decays_with_time_since_event():
    fresh = compute_disaster_history_boost(76.086, 11.510, "landslide", [_event("landslide", 76.086, 11.510, 0.01)], NOW)
    old = compute_disaster_history_boost(
        76.086, 11.510, "landslide", [_event("landslide", 76.086, 11.510, DISASTER_HISTORY["halfLifeYears"])], NOW
    )
    assert old == pytest.approx(fresh / 2, rel=0.02)


def test_wrong_hazard_type_gives_zero_boost():
    events = [_event("cloudburst", 76.086, 11.510, years_ago=0.01)]
    assert compute_disaster_history_boost(76.086, 11.510, "landslide", events, NOW) == 0.0


def test_multiple_matching_events_take_the_max_not_the_sum():
    events = [
        _event("landslide", 76.086, 11.510, years_ago=0.01),
        _event("landslide", 76.086, 11.510, years_ago=0.01),
    ]
    single = compute_disaster_history_boost(76.086, 11.510, "landslide", events[:1], NOW)
    both = compute_disaster_history_boost(76.086, 11.510, "landslide", events, NOW)
    assert both == single


def test_boost_is_clamped_within_configured_max():
    events = [_event("landslide", 76.086, 11.510, years_ago=0.0)]
    boost = compute_disaster_history_boost(76.086, 11.510, "landslide", events, NOW)
    assert 0.0 <= boost <= DISASTER_HISTORY["maxBoost"]
