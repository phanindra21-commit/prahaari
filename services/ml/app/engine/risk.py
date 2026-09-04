"""Risk and Exposure (METHODOLOGY §0):

    Risk = clamp( HazardIntensity * Exposure * VulnerabilityIndex / (1 + CopingCapacity), 0, 1 )

`Exposure` is the fraction of a habitation's estimated built-up footprint
that intersects each hazard zone class, weighted by that class's relative
intensity — not just "is the habitation's centroid inside a zone," so a
habitation straddling a zone boundary gets a genuinely fractional exposure
rather than an all-or-nothing 0/1 value. The footprint itself is a circle
sized from the habitation's household count via capacity-norms.json's
per-household land norm (there is no surveyed habitation boundary polygon
in this dataset — see docs/SCORING_PIPELINE.md), centered on the
habitation's centroid, correctly foreshortened for longitude at that
latitude (a circle in meters, not a circle in degrees).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.affinity import scale
from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from app.config_loader import CAPACITY_NORMS

METERS_PER_DEGREE_LAT = 110_570.0

# Relative intensity weight per zone class for the exposure calculation —
# a Red-zone fraction of the footprint counts fully, Green counts almost
# nothing, mirroring the same worst-to-safest ordering zone-thresholds.json
# uses elsewhere (not itself a config value: it is a fixed ordinal weighting
# of the four zone classes already defined in zone-thresholds.json, not an
# independent tunable parameter).
ZONE_INTENSITY: dict[str, float] = {"Red": 1.0, "Orange": 0.7, "Yellow": 0.35, "Green": 0.05}


def habitation_footprint(lon: float, lat: float, households: int) -> BaseGeometry:
    """A circle (in real meters, not degrees) approximating the habitation's built-up area."""
    area_sqm = max(households, 1) * CAPACITY_NORMS["land"]["effectiveLandPerHouseholdSqm"]
    radius_m = math.sqrt(area_sqm / math.pi)

    radius_deg_lat = radius_m / METERS_PER_DEGREE_LAT
    meters_per_degree_lon = 111_320.0 * math.cos(math.radians(lat))
    radius_deg_lon = radius_m / meters_per_degree_lon if meters_per_degree_lon > 0 else radius_deg_lat

    circle = Point(lon, lat).buffer(radius_deg_lat, quad_segs=16)
    if radius_deg_lat <= 0:
        return circle
    return scale(circle, xfact=radius_deg_lon / radius_deg_lat, yfact=1.0, origin=(lon, lat))


def compute_exposure(footprint: BaseGeometry, zone_geoms_by_class: dict[str, BaseGeometry]) -> float:
    """Weighted fraction of `footprint`'s area covered by each zone class. Any part of the
    footprint outside every supplied zone geometry (e.g. a sliver right at the district
    boundary) contributes zero — never inflated onto the classes that ARE covered."""
    total_area = footprint.area
    if total_area <= 0:
        return 0.0

    weighted = 0.0
    for zone_class, geometry in zone_geoms_by_class.items():
        if geometry is None or geometry.is_empty:
            continue
        intersection_fraction = footprint.intersection(geometry).area / total_area
        weighted += intersection_fraction * ZONE_INTENSITY.get(zone_class, 0.0)

    return max(0.0, min(1.0, weighted))


def compute_risk(hazard_score: float, exposure: float, vi: float, coping_capacity: float) -> float:
    risk = hazard_score * exposure * vi / (1.0 + coping_capacity)
    return max(0.0, min(1.0, risk))


@dataclass
class GoverningRisk:
    hazard_type: str
    risk: float


def governing_risk(risk_by_hazard: dict[str, float]) -> GoverningRisk:
    """The worst (maximum) risk across every hazard the habitation is exposed to — the
    governing risk for RPI purposes — while every per-hazard value is still retained by
    the caller for the Assessment document."""
    if not risk_by_hazard:
        raise ValueError("governing_risk requires at least one hazard's risk value")
    hazard_type = max(risk_by_hazard, key=lambda h: risk_by_hazard[h])
    return GoverningRisk(hazard_type=hazard_type, risk=risk_by_hazard[hazard_type])
