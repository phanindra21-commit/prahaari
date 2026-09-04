"""Carrying capacity across five independent constraint domains
(METHODOLOGY §5): CarryingCapacity = min(land, water, education, health,
access); the officer-facing binding constraint is whichever domain the
minimum came from — this is the strongest single technical differentiator
of the platform, so both the number and the reason it landed there must
be correct and visible, not just the final minimum.

Norms: `packages/shared/src/config/capacity-norms.json`. Water uses the
Jal Jeevan Mission 55 LPCD standard. Education uses RTE Act
pupil-teacher/distance norms. Health uses IPHS population norms, which
differ for hilly/tribal terrain (Wayanad/Kerala) vs plains (Ganjam/
Odisha) — per METHODOLOGY §5.4, `terrain_tier` must be supplied by the
caller from `District.state`, never inferred here.

**Health formula correction (documentation bug, not a policy choice):**
METHODOLOGY §5.4, as originally written, gave
`C_health = SpareCapacity / (IPHS_PopulationNorm / AvgHouseholdSize)`.
That denominator has units of households-per-facility (a population/
facility norm divided by population/household), not population-per-
household — inconsistent with `C_water`'s and `C_education`'s pattern of
dividing spare capacity by a per-household *rate*. As literally
implemented it drove every candidate site's health capacity to a few
tenths of a household (verified against every seeded site: 0.28-0.39
households, Wayanad and Ganjam alike), which would make CarryingCapacity
~0 everywhere and no relocation ever matchable — not a real finding
about site viability, a units bug.

Corrected to `C_health = min(SpareCapacity / AvgHouseholdSize, IPHS_PopulationNorm / AvgHouseholdSize)`:
the first term mirrors `C_water`/`C_education`'s "spare capacity / per-
household rate" pattern (dimensionally sound, and what actually drives
the result for realistic inputs); the second term is a physically real
ceiling — a single facility cannot house more newly-relocated population
than its own tier-specific design norm allows, converted to households
— which is where `terrain_tier`'s hilly-tribal-vs-plains distinction
legitimately re-enters the computation (Wayanad's smaller 20,000-
population PHC norm caps out at fewer households per facility than
Ganjam's 30,000). For every seeded site the spare-capacity term is well
under this ceiling, so the correction is a defensive cap, not a second
degenerate divisor. See METHODOLOGY §5.4's matching note.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.config_loader import CAPACITY_NORMS

TerrainTier = Literal["HILLY_TRIBAL", "PLAINS"]


@dataclass
class CapacityResult:
    by_land: float
    by_water: float
    by_education: float
    by_health: float
    by_access: float
    effective_capacity: float
    binding_constraint: str


def compute_carrying_capacity(
    raw_attributes: dict,
    area_sqm: float,
    state: str,
    terrain_tier: TerrainTier,
) -> CapacityResult:
    land_norms = CAPACITY_NORMS["land"]
    water_norms = CAPACITY_NORMS["water"]
    education_norms = CAPACITY_NORMS["education"]["rte"]
    health_norms = CAPACITY_NORMS["health"]["iphs"]
    access_norms = CAPACITY_NORMS["access"]

    avg_household_size = water_norms["stateAvgHouseholdSize"].get(
        state, water_norms["defaultAvgHouseholdSize"]
    )

    by_land = area_sqm / land_norms["effectiveLandPerHouseholdSqm"]

    by_water = raw_attributes["availableWaterSupplyLpd"] / (
        water_norms["lpcd"] * avg_household_size
    )

    school_age_children_per_household = (
        avg_household_size * education_norms["schoolAgeChildrenShareOfPopulation"]
    )
    by_education = (
        raw_attributes["nearbySchoolSpareCapacitySeats"] / school_age_children_per_household
    )

    # See this module's docstring for why this is min(), not the plain
    # division METHODOLOGY §5.4 originally specified.
    by_health_from_spare_capacity = (
        raw_attributes["nearbyHealthFacilitySpareCapacityPopulation"] / avg_household_size
    )
    phc_population_norm_key = (
        "phcPopulationNormHillyTribal" if terrain_tier == "HILLY_TRIBAL" else "phcPopulationNormPlains"
    )
    by_health_facility_ceiling = health_norms[phc_population_norm_key] / avg_household_size
    by_health = min(by_health_from_spare_capacity, by_health_facility_ceiling)

    access_point_count = (
        1 if raw_attributes["distanceToAllWeatherRoadM"] <= access_norms["allWeatherRoadMaxDistanceMeters"] else 0
    )
    by_access = access_point_count * access_norms["householdsPerAccessPointCapacity"]

    values = {
        "LAND": by_land,
        "WATER": by_water,
        "EDUCATION": by_education,
        "HEALTH": by_health,
        "ACCESS": by_access,
    }
    binding_constraint = min(values, key=lambda k: values[k])

    return CapacityResult(
        by_land=by_land,
        by_water=by_water,
        by_education=by_education,
        by_health=by_health,
        by_access=by_access,
        effective_capacity=values[binding_constraint],
        binding_constraint=binding_constraint,
    )
