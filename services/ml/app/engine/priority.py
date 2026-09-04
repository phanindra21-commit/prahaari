"""Relocation Priority Index (METHODOLOGY §3):

    RPI = W_r * normalize(Risk) + W_v * VI

**What `normalize(Risk)` means here, and why (a Step 5 finding, not the
original Step 2/3 assumption):** Risk (risk.py) is already guaranteed in
[0, 1] by construction, so an earlier version of this module treated
`normalize(Risk)` as a no-op — Risk passed through unchanged. That
produces a structural bug: `Risk = H * E * VI / (1 + CopingCapacity)` has
VI as a multiplicative factor, so `Risk <= VI` always; with RPI a weighted
average of Risk and VI, that makes `RPI <= VI` for EVERY habitation,
regardless of hazard severity. Verified against the real Wayanad/Ganjam
run: every one of 27 Red/Orange habitations landed in MediumTerm — zero
in ShortTerm or Immediate — including Chooralmala and Mundakkai (the real
2024 landslide site, VI 0.34/0.39, capped there even at their own
correctly-computed Red-zone hazard score). No realistic VI value in this
dataset clears 0.70, so under a no-op normalize, NOTHING could ever reach
Immediate no matter how severe the hazard — directly contradicting
METHODOLOGY §3's own stated intent that hazard severity, not vulnerability,
should be what triggers urgency.

`normalize(Risk)` is instead implemented as **min-max rescaling of each
habitation's governing Risk against the other Red/Orange habitations in
the same assessment run** (`normalize_risk` below) — the standard meaning
of "normalize" in a scoring context, and the only interpretation
consistent with §3's stated intent, since raw Risk being already in [0,1]
gives a no-op reading no useful work to do. This is scoped per
district-per-run (`assessment.py::assess_habitations_batch`'s population),
not state-wide across every district ever assessed — see
docs/METHODOLOGY.md §3 and docs/SCORING_PIPELINE.md for the caveat this
implies for cross-district comparison, and the worked numeric example.

Only habitations whose zone class is Red or Orange get an RPI/bucket at
all (METHODOLOGY §1.3) — `bucket_for_rpi` is only ever called for those;
a Yellow/Green habitation's Assessment carries `relocationPriorityIndex:
null, priorityBucket: null` instead (see assessment.py).
"""

from __future__ import annotations

from app.config_loader import PRIORITY_WEIGHTS


def normalize_risk(risk: float, min_risk: float, max_risk: float) -> float:
    """Min-max rescales `risk` against [min_risk, max_risk] — the range of
    governing Risk values across the OTHER habitations in the same
    assessment run (see the module docstring for why). If every habitation
    in the run has the same risk (max == min — e.g. a run of exactly one),
    it/they are, by definition, the most urgent within their own batch:
    normalized to 1.0 rather than an undefined 0/0."""
    if max_risk <= min_risk:
        return 1.0
    return max(0.0, min(1.0, (risk - min_risk) / (max_risk - min_risk)))

PLAIN_LANGUAGE_LABELS: dict[str, str] = {
    "risk": "Hazard risk relative to other assessed habitations (severity x exposure x vulnerability, discounted by coping capacity, then ranked against this run's other Red/Orange habitations)",
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


def compute_rpi(normalized_risk: float, vi: float) -> float:
    weights = PRIORITY_WEIGHTS["weights"]
    rpi = weights["risk"] * normalized_risk + weights["vulnerability"] * vi
    return max(0.0, min(1.0, rpi))


def bucket_for_rpi(rpi: float) -> str:
    buckets = PRIORITY_WEIGHTS["buckets"]
    if rpi >= buckets["immediate"]:
        return "Immediate"
    if rpi >= buckets["shortTerm"]:
        return "ShortTerm"
    return "MediumTerm"


def rpi_contributions(
    normalized_risk: float,
    normalized_indicators: dict[str, float],
    top_n: int = 5,
) -> list[dict]:
    """An EXACT (not approximated) additive decomposition of RPI into signed
    contributions, since RPI is fully transparent linear/weighted-sum
    arithmetic, not an opaque ML model — SHAP is for explaining models
    whose internals are otherwise a black box, which does not describe
    this formula, so it is not used here (see docs/METHODOLOGY.md §3 and
    docs/SCORING_PIPELINE.md for the worked derivation this mirrors):

        RPI = W_r * normalize(Risk) + W_v * sum_d( dimensionWeight_d * sum_i( indicatorWeight_i * normalized_i ) )
            = (W_r * normalize(Risk)) + sum_over_every_leaf_indicator( W_v * dimensionWeight * indicatorWeight * normalized )

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
            "contribution": weights["risk"] * normalized_risk,
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
