"""Disaster-history exposure boost (METHODOLOGY §0's Disaster History note).

Recurrence at a previously-affected site is a well-established signal in
hazard assessment: a location that has already experienced a hazard event
is not equally likely, but MORE likely, to experience the same hazard type
again than an otherwise-identical location with no recorded history
(repeat landslides along the same destabilized slope, repeat cyclone
landfall along the same coastal corridor). `HazardEvent` records
(data/seed/hazard-events.json / the HazardEvent collection) previously
existed only as read-only historical reference data — they never fed into
a habitation's hazard score. This module is what makes them do so: a
habitation within `influenceRadiusKm` of a recorded event's extent, for
the SAME hazard type, gets its exposure for that hazard elevated, decaying
linearly with distance from the event and with an exponential half-life
in time since it occurred. Parameters live in
packages/shared/src/config/disaster-history.json (single source of truth,
mirrored by app/config_loader.py — see that module's docstring).

Pure function, no I/O: `apps/api`'s job worker supplies the relevant
HazardEvent records already resolved to lon/lat + date, per
docs/ARCHITECTURE.md's "services/ml stays stateless" rule.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from app.config_loader import DISASTER_HISTORY

_KM_PER_DEG_LAT = 110.57


def _distance_km(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    klon = 111.32 * math.cos(math.radians(lat0))
    return math.hypot((lon1 - lon0) * klon, (lat1 - lat0) * _KM_PER_DEG_LAT)


@dataclass
class HazardEventPoint:
    hazard_type: str
    lon: float
    lat: float
    date: datetime


def compute_disaster_history_boost(
    lon: float,
    lat: float,
    hazard_type: str,
    events: list[HazardEventPoint],
    as_of: datetime,
) -> float:
    """The exposure boost in [0, maxBoost] for one habitation/hazard pair.

    Takes the MAX across every matching event within range, not the sum —
    two recorded events near the same site should not double the boost;
    the site is elevated-risk because it has A history, not proportionally
    more so for each additional listed event.
    """
    radius_km = DISASTER_HISTORY["influenceRadiusKm"]
    half_life_years = DISASTER_HISTORY["halfLifeYears"]
    max_boost = DISASTER_HISTORY["maxBoost"]

    best = 0.0
    for event in events:
        if event.hazard_type != hazard_type:
            continue
        distance_km = _distance_km(lon, lat, event.lon, event.lat)
        if distance_km > radius_km:
            continue
        spatial_decay = 1.0 - (distance_km / radius_km)
        years_since = max(0.0, (as_of - event.date).days / 365.25)
        temporal_decay = 0.5 ** (years_since / half_life_years)
        boost = max_boost * spatial_decay * temporal_decay
        best = max(best, boost)
    return best
