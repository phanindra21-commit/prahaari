"""Classifies grid cells into zone classes (METHODOLOGY §1.3) and dissolves
contiguous same-class, same-hazard cells into zone polygons.

Classification runs on the BLENDED score (app.engine.blend.blended_score)
against per-hazard breakpoints in zone-thresholds.json
(app.config_loader.ZONE_THRESHOLDS) — never the overlay or ML score alone.
Dissolve unions same-class cell boundaries (regenerated from each h3Index
via h3-py, so raw grid-cell geometry never needs to be persisted
separately) with shapely.ops.unary_union, producing one Polygon or
MultiPolygon per (district, hazard, zoneClass). A simplified variant is
also produced — the officer-facing map renders the simplified geometry;
audit/analysis uses the full-resolution one.

Multi-hazard aggregation (METHODOLOGY §1.3, zone-thresholds.json
`multiHazardAggregation`): a habitation's overall zone class is the worst
class across every hazard it is exposed to, escalating to Red if two or
more hazards independently classify as Orange.
"""

from __future__ import annotations

from functools import lru_cache

import h3
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

from app.config_loader import ZONE_THRESHOLDS

SIMPLIFY_TOLERANCE_DEGREES = 0.0005  # ~50m at these latitudes

ZONE_ORDER = {"Green": 0, "Yellow": 1, "Orange": 2, "Red": 3}


def classify_zone(blended_score: float, hazard: str) -> str:
    """Maps a blended [0,1] susceptibility score to a zone class per
    zone-thresholds.json's per-hazard cutoffs (each is the MINIMUM score
    required to reach that class)."""
    thresholds = ZONE_THRESHOLDS["perHazard"][hazard]
    if blended_score >= thresholds["red"]:
        return "Red"
    if blended_score >= thresholds["orange"]:
        return "Orange"
    if blended_score >= thresholds["yellow"]:
        return "Yellow"
    return "Green"


@lru_cache(maxsize=None)
def cell_polygon(h3_index: str) -> Polygon:
    """Regenerates a cell's boundary polygon from its h3Index. h3-py's
    cell_to_boundary returns an OPEN ring of (lat, lng) tuples — shapely
    and GeoJSON both want a CLOSED ring of (lng, lat).

    `cell_polygon(h3_index)` is a pure function of `h3_index` alone (no
    hazard/district/zone-class dependence — the same physical grid cell
    has the same boundary regardless of which hazard's zones it's being
    dissolved for), yet `dissolve_zone_class` was calling it on the SAME
    h3Index up to ~6x per scenario run (once per baseline/scenario/
    changed-geometry dissolve pass, per hazard) before this cache was
    added — profiled at ~6.1s of a Chamoli scenario run's ~21s engine
    time (58,206 calls for what should be ~10,167 unique cells; see
    docs/METHODOLOGY.md's performance note). `lru_cache` is safe here
    because shapely geometries are immutable — every caller sharing the
    same cached `Polygon` object can never see another caller's mutation,
    because there isn't one. Unbounded (`maxsize=None`) is safe too: the
    key space is every H3 resolution-8 cell across this deployment's
    pilot districts, a few tens of thousands at most, not user input."""
    boundary = h3.cell_to_boundary(h3_index)
    ring = [(lng, lat) for lat, lng in boundary]
    ring.append(ring[0])
    return Polygon(ring)


def dissolve_zone_class(h3_indexes: list[str]) -> tuple[Polygon | MultiPolygon, Polygon | MultiPolygon]:
    """Dissolves every cell in `h3_indexes` (assumed same district, hazard,
    and zone class) into one geometry, returning (full_resolution,
    simplified)."""
    if not h3_indexes:
        raise ValueError("dissolve_zone_class requires at least one cell")
    dissolved = unary_union([cell_polygon(h) for h in h3_indexes])
    simplified = dissolved.simplify(SIMPLIFY_TOLERANCE_DEGREES, preserve_topology=True)
    return dissolved, simplified


def geometry_to_geojson(geometry: Polygon | MultiPolygon) -> dict:
    return mapping(geometry)


def aggregate_multi_hazard(zone_class_by_hazard: dict[str, str]) -> str:
    """A habitation's overall zone class: worst class across hazards, unless
    two or more hazards are independently Orange, in which case it
    escalates per zone-thresholds.json's multiHazardAggregation rule."""
    if not zone_class_by_hazard:
        return "Green"

    worst = max(zone_class_by_hazard.values(), key=lambda c: ZONE_ORDER[c])

    rule = ZONE_THRESHOLDS["multiHazardAggregation"]
    trigger_count = rule["orangeCountEscalationTrigger"]
    escalates_to = rule["escalatesTo"]

    orange_count = sum(1 for c in zone_class_by_hazard.values() if c == "Orange")
    if orange_count >= trigger_count and ZONE_ORDER[worst] < ZONE_ORDER[escalates_to]:
        return escalates_to
    return worst
