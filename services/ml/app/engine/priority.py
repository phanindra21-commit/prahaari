"""Relocation Priority Index (METHODOLOGY §3):

    RPI = W_r * normalize(Risk) + W_v * VI

`normalize(Risk)` is Risk unchanged: Risk (risk.py) is already guaranteed
in [0, 1] by construction (it is a product of three [0,1] terms divided by
something >= 1), so there is no rescaling left to do — see
docs/METHODOLOGY.md §3's implementation note.

Only habitations whose zone class is Red or Orange get an RPI/bucket at
all (METHODOLOGY §1.3) — `bucket_for_rpi` is only ever called for those;
a Yellow/Green habitation's Assessment carries `relocationPriorityIndex:
null, priorityBucket: null` instead (see pipeline.py).
"""

from __future__ import annotations

from app.config_loader import PRIORITY_WEIGHTS

PLAIN_LANGUAGE_LABELS: dict[str, str] = {
    "risk": "Overall hazard risk (severity x exposure x vulnerability, discounted by coping capacity)",
    "shareUnder5": "Share of population under 5 years old",
    "shareOver60": "Share of population over 60 years old",
    "womenHeadedHouseholdShare": "Share of women-headed households",
    "disabledPersonsShare": "Share of persons with disabilities",
    "bplShare": "Share of households below the poverty line",
    "scStShare": "Share of Scheduled Caste / Scheduled Tribe population",
    "literacyRateInverse": "Low literacy rate",
    "primaryLivelihoodDependenceShare": "Dependence on a single primary livelihood",
    "kutchaHousingShare": "Share of kutcha (non-permanent) housing",
    "buildingAgeIndex": "Older building stock",
    "foundationTypeRisk": "Weak building foundation type",
    "distanceToAllWeatherRoad": "Distance to the nearest all-weather road",
    "distanceToPHC": "Distance to the nearest Primary Health Centre",
    "mobileNetworkCoverageInverse": "Poor mobile network coverage",
    "evacuationRouteRedundancyInverse": "Lack of alternate evacuation routes",
}


def compute_rpi(risk: float, vi: float) -> float:
    weights = PRIORITY_WEIGHTS["weights"]
    rpi = weights["risk"] * risk + weights["vulnerability"] * vi
    return max(0.0, min(1.0, rpi))


def bucket_for_rpi(rpi: float) -> str:
    buckets = PRIORITY_WEIGHTS["buckets"]
    if rpi >= buckets["immediate"]:
        return "Immediate"
    if rpi >= buckets["shortTerm"]:
        return "ShortTerm"
    return "MediumTerm"


def rpi_contributions(
    risk: float,
    normalized_indicators: dict[str, float],
    top_n: int = 5,
) -> list[dict]:
    """An EXACT (not approximated) additive decomposition of RPI into signed
    contributions, since RPI is fully transparent linear/weighted-sum
    arithmetic, not an opaque ML model — SHAP is for explaining models
    whose internals are otherwise a black box, which does not describe
    this formula, so it is not used here (see docs/METHODOLOGY.md §3 and
    docs/SCORING_PIPELINE.md for the worked derivation this mirrors):

        RPI = W_r * Risk + W_v * sum_d( dimensionWeight_d * sum_i( indicatorWeight_i * normalized_i ) )
            = (W_r * Risk) + sum_over_every_leaf_indicator( W_v * dimensionWeight * indicatorWeight * normalized )

    Every term is >= 0 by construction (weights and normalized indicators
    are all non-negative), so every returned entry's direction is
    INCREASES_RISK — an honest reflection of the formula's structure, not
    an omission. Returns the top `top_n` by |contribution|, each carrying
    both the machine `factor` key and a human-readable `label`.
    """
    from app.config_loader import VULNERABILITY_WEIGHTS  # local import: avoids a cross-module cycle

    weights = PRIORITY_WEIGHTS["weights"]
    contributions: list[dict] = [
        {
            "factor": "risk",
            "contribution": weights["risk"] * risk,
            "direction": "INCREASES_RISK",
            "label": PLAIN_LANGUAGE_LABELS["risk"],
        }
    ]

    for dimension_name, dimension_config in VULNERABILITY_WEIGHTS["dimensions"].items():
        dimension_weight = dimension_config["weight"]
        for indicator_name, indicator_weight in dimension_config["indicators"].items():
            contribution = (
                weights["vulnerability"]
                * dimension_weight
                * indicator_weight
                * normalized_indicators[indicator_name]
            )
            contributions.append(
                {
                    "factor": indicator_name,
                    "contribution": contribution,
                    "direction": "INCREASES_RISK",
                    "label": PLAIN_LANGUAGE_LABELS.get(indicator_name, indicator_name),
                }
            )

    contributions.sort(key=lambda c: abs(c["contribution"]), reverse=True)
    return contributions[:top_n]
