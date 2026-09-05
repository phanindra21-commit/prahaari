"""Safe route corridors (Step 10 Part 3): A* pathfinding over the H3 hazard
grid, treating each cell as a graph node whose traversal cost rises with
its own governing multi-hazard blendedScore — a Red cell is near-
impassable relative to Green, Orange is costly, Green is cheap. The cost
curve lives in packages/shared/src/config/routing-costs.json (this
module's `app.config_loader.ROUTING_COSTS`), the same single-source-of-
truth pattern as every other weight config in this project.

Scope, stated plainly (see docs/METHODOLOGY.md's routing section for the
full note): this is corridor-level routing over the hazard grid, NOT road-
network routing. A real deployment would run the same A* algorithm over
the PMGSY/OSM road graph with the hazard surface supplying edge cost,
rather than moving in straight lines between H3 cell centroids the way
this demo does.

Stateless (no MongoDB/filesystem access) — apps/api resolves a district's
GridCells to plain `GridCellForRouting` inputs first, matching every other
engine module's convention.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import h3

from app.config_loader import ROUTING_COSTS

_ZONE_CLASSES = ("Green", "Yellow", "Orange", "Red")
_EARTH_RADIUS_KM = 6371.0088


@dataclass
class GridCellForRouting:
    h3_index: str
    lon: float
    lat: float
    # The cell's GOVERNING hazard's zone class/score — whichever of the
    # district's hazards has the highest blendedScore at this cell. Which
    # hazard that is, and how per-hazard scores combine into one per-cell
    # figure, is the caller's decision (apps/api's siteStage.ts): this
    # module only ever reasons about one scalar zone class/score per cell.
    zone_class: str
    score: float


@dataclass
class RouteExposure:
    zone_class: str
    km: float
    percent: float


@dataclass
class RouteResult:
    route_geometry: dict
    direct_geometry: dict
    route_length_km: float
    direct_length_km: float
    detour_ratio: float
    route_exposure: list[RouteExposure]
    direct_exposure: list[RouteExposure]
    route_safety_score: float


def _haversine_km(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    phi0, phi1 = math.radians(lat0), math.radians(lat1)
    dphi = math.radians(lat1 - lat0)
    dlambda = math.radians(lon1 - lon0)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi0) * math.cos(phi1) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _nearest_cell(lon: float, lat: float, by_index: dict[str, GridCellForRouting]) -> str | None:
    """Snaps a raw lon/lat to a cell present in the grid. Tries the exact H3
    cell first (fast, correct in the overwhelming majority of cases); falls
    back to a linear nearest-centroid scan for a point whose exact cell
    fell just outside the district's grid (e.g. a habitation very close to
    the district boundary, where the H3 cell covering it may not have had
    its own centroid inside the polygon at grid-generation time)."""
    if not by_index:
        return None
    resolution = h3.get_resolution(next(iter(by_index)))
    exact = h3.latlng_to_cell(lat, lon, resolution)
    if exact in by_index:
        return exact
    best_index: str | None = None
    best_dist = math.inf
    for index, cell in by_index.items():
        d = _haversine_km(lon, lat, cell.lon, cell.lat)
        if d < best_dist:
            best_dist = d
            best_index = index
    return best_index


def _governing_multiplier(zone_class: str) -> float:
    return ROUTING_COSTS["zoneClassMultiplier"][zone_class]


def _astar(
    start: str,
    goal: str,
    by_index: dict[str, GridCellForRouting],
) -> list[str] | None:
    base_cost_per_km = ROUTING_COSTS["baseCostPerKm"]
    cheapest_multiplier = min(ROUTING_COSTS["zoneClassMultiplier"].values())
    goal_cell = by_index[goal]

    def heuristic(index: str) -> float:
        cell = by_index[index]
        return _haversine_km(cell.lon, cell.lat, goal_cell.lon, goal_cell.lat) * base_cost_per_km * cheapest_multiplier

    open_heap: list[tuple[float, str]] = [(heuristic(start), start)]
    came_from: dict[str, str] = {}
    g_score: dict[str, float] = {start: 0.0}
    visited: set[str] = set()

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if current == goal:
            path = [current]
            while path[-1] != start:
                path.append(came_from[path[-1]])
            path.reverse()
            return path
        if current in visited:
            continue
        visited.add(current)

        current_cell = by_index[current]
        for neighbor in h3.grid_ring(current, 1):
            neighbor_cell = by_index.get(neighbor)
            if neighbor_cell is None or neighbor in visited:
                continue
            edge_km = _haversine_km(current_cell.lon, current_cell.lat, neighbor_cell.lon, neighbor_cell.lat)
            edge_cost = edge_km * base_cost_per_km * _governing_multiplier(neighbor_cell.zone_class)
            tentative_g = g_score[current] + edge_cost
            if tentative_g < g_score.get(neighbor, math.inf):
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g
                heapq.heappush(open_heap, (tentative_g + heuristic(neighbor), neighbor))

    return None


def _exposure_from_segments(
    segments: list[tuple[float, str]],
) -> list[RouteExposure]:
    """`segments` is a list of (km, zoneClass) for each stretch of the
    route/line. Aggregates to one entry per zone class actually present,
    Red-to-Green order, each with its share of the total distance."""
    totals: dict[str, float] = {}
    for km, zone_class in segments:
        totals[zone_class] = totals.get(zone_class, 0.0) + km
    total_km = sum(totals.values())
    result = []
    for zone_class in _ZONE_CLASSES:
        km = totals.get(zone_class, 0.0)
        if km <= 0:
            continue
        percent = (km / total_km * 100) if total_km > 0 else 0.0
        result.append(RouteExposure(zone_class=zone_class, km=km, percent=percent))
    return result


def _safety_score(exposure: list[RouteExposure]) -> float:
    total_km = sum(e.km for e in exposure)
    if total_km <= 0:
        return 1.0
    weights = ROUTING_COSTS["routeSafetyWeight"]
    weighted = sum(e.km * weights[e.zone_class] for e in exposure)
    return weighted / total_km


def _sample_direct_line(
    origin_lon: float,
    origin_lat: float,
    dest_lon: float,
    dest_lat: float,
    by_index: dict[str, GridCellForRouting],
) -> tuple[list[tuple[float, str]], float]:
    """Samples the straight line between origin and destination roughly
    every 250m (capped at 2000 samples for a pathological long line) and
    looks up each sample's nearest grid cell to attribute a zone class."""
    total_km = _haversine_km(origin_lon, origin_lat, dest_lon, dest_lat)
    if total_km <= 0:
        return [], 0.0
    sample_count = max(2, min(2000, math.ceil(total_km / 0.25) + 1))
    segments: list[tuple[float, str]] = []
    step_km = total_km / (sample_count - 1)
    for i in range(sample_count - 1):
        t0 = i / (sample_count - 1)
        t1 = (i + 1) / (sample_count - 1)
        mid_lon = origin_lon + (dest_lon - origin_lon) * (t0 + t1) / 2
        mid_lat = origin_lat + (dest_lat - origin_lat) * (t0 + t1) / 2
        nearest = _nearest_cell(mid_lon, mid_lat, by_index)
        zone_class = by_index[nearest].zone_class if nearest else "Green"
        segments.append((step_km, zone_class))
    return segments, total_km


def compute_route(
    origin_lon: float,
    origin_lat: float,
    destination_lon: float,
    destination_lat: float,
    grid_cells: list[GridCellForRouting],
) -> RouteResult | None:
    """Returns None when routing cannot be computed (no grid cells supplied,
    or no path exists between the origin and destination cells) — the
    caller (site_matching.py) treats that as "no routing info available"
    and falls back to ranking by suitability alone, exactly as it did
    before this feature existed."""
    if not grid_cells:
        return None

    by_index = {c.h3_index: c for c in grid_cells}

    start = _nearest_cell(origin_lon, origin_lat, by_index)
    goal = _nearest_cell(destination_lon, destination_lat, by_index)
    if start is None or goal is None:
        return None

    direct_segments, direct_length_km = _sample_direct_line(
        origin_lon, origin_lat, destination_lon, destination_lat, by_index
    )
    direct_exposure = _exposure_from_segments(direct_segments)
    direct_geometry = {
        "type": "LineString",
        "coordinates": [[origin_lon, origin_lat], [destination_lon, destination_lat]],
    }

    if start == goal:
        route_geometry = {"type": "LineString", "coordinates": [[origin_lon, origin_lat], [destination_lon, destination_lat]]}
        return RouteResult(
            route_geometry=route_geometry,
            direct_geometry=direct_geometry,
            route_length_km=direct_length_km,
            direct_length_km=direct_length_km,
            detour_ratio=1.0,
            route_exposure=direct_exposure,
            direct_exposure=direct_exposure,
            route_safety_score=_safety_score(direct_exposure),
        )

    path = _astar(start, goal, by_index)
    if path is None:
        return None

    coordinates = [[origin_lon, origin_lat]] + [[by_index[i].lon, by_index[i].lat] for i in path] + [
        [destination_lon, destination_lat]
    ]
    route_segments: list[tuple[float, str]] = []
    route_length_km = 0.0
    for i in range(len(coordinates) - 1):
        lon0, lat0 = coordinates[i]
        lon1, lat1 = coordinates[i + 1]
        seg_km = _haversine_km(lon0, lat0, lon1, lat1)
        # Attribute each hop to the zone class of the cell it arrives at;
        # the origin->first-cell and last-cell->destination hops use that
        # endpoint cell's class too (both are within the same or an
        # adjacent cell, never a materially different hazard exposure).
        endpoint_index = path[min(i, len(path) - 1)]
        route_segments.append((seg_km, by_index[endpoint_index].zone_class))
        route_length_km += seg_km

    route_exposure = _exposure_from_segments(route_segments)
    detour_ratio = (route_length_km / direct_length_km) if direct_length_km > 0 else 1.0

    return RouteResult(
        route_geometry={"type": "LineString", "coordinates": coordinates},
        direct_geometry=direct_geometry,
        route_length_km=route_length_km,
        direct_length_km=direct_length_km,
        detour_ratio=detour_ratio,
        route_exposure=route_exposure,
        direct_exposure=direct_exposure,
        route_safety_score=_safety_score(route_exposure),
    )
