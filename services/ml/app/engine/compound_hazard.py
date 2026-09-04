"""Compound-hazard detection (METHODOLOGY §0's Compound Hazards note).

Some hazard pairs are not independent alternatives to rank against each
other by raw score: one is a TRIGGER, the other is the MECHANISM/
CONSEQUENCE of the same physical event. Cloudburst (extreme
short-duration rainfall) is a documented trigger for landslide
(rainfall-induced slope failure) on already-susceptible terrain — the
causal chain behind the July 2024 Wayanad disaster. `governing_risk()`
(risk.py) picks the single numerically-largest hazard and reports it
alone; when the site's story is actually "rainfall-triggered slope
failure", reporting only whichever of the two happens to score higher
loses that story, and reporting the TRIGGER as if it were the
consequence-bearing hazard is misleading — the trigger and the mechanism
are not competing for who is "worse", they compound.

This module detects when a configured (trigger, mechanism) pair is
BOTH independently at or above `activationZoneClasses` (Red/Orange) at
the same habitation — never inferred from one hazard alone — and, when
so, combines their risk with a standard probabilistic-OR rule (treating
each Risk score, already bounded in [0,1] by construction, as a
probability-like quantity):

    CompoundRisk = 1 - (1 - TriggerRisk) * (1 - MechanismRisk)

This is >= max(TriggerRisk, MechanismRisk) always (the union of two
correlated bad outcomes is at least as likely as either alone), and
reduces to a principled combination rather than an arbitrary multiplier
tuned to hit a target score. See packages/shared/src/config/
compound-hazards.json for the configured pairs and the reasoning for
keeping this to exactly one pair today.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config_loader import COMPOUND_HAZARDS


@dataclass
class CompoundHazardResult:
    trigger: str
    mechanism: str
    trigger_risk: float
    mechanism_risk: float
    compound_risk: float


def detect_compound_hazard(
    risk_by_hazard: dict[str, float],
    zone_class_by_hazard: dict[str, str],
) -> CompoundHazardResult | None:
    """Returns the first configured pair that is jointly active at this
    habitation (both hazards present and at/above an activation zone
    class), or None if no configured pair applies here."""
    activation_classes = set(COMPOUND_HAZARDS["activationZoneClasses"])

    for pair in COMPOUND_HAZARDS["pairs"]:
        trigger, mechanism = pair["trigger"], pair["mechanism"]
        if trigger not in risk_by_hazard or mechanism not in risk_by_hazard:
            continue
        if zone_class_by_hazard.get(trigger) not in activation_classes:
            continue
        if zone_class_by_hazard.get(mechanism) not in activation_classes:
            continue

        trigger_risk = risk_by_hazard[trigger]
        mechanism_risk = risk_by_hazard[mechanism]
        compound_risk = 1.0 - (1.0 - trigger_risk) * (1.0 - mechanism_risk)
        return CompoundHazardResult(
            trigger=trigger,
            mechanism=mechanism,
            trigger_risk=trigger_risk,
            mechanism_risk=mechanism_risk,
            compound_risk=max(0.0, min(1.0, compound_risk)),
        )

    return None
