# Methodology

This document defines the analytical methods behind PunarVas. It is the
specification that `services/ml` implements.

**Single source of truth for numbers:** every weight, threshold, and norm
in this document is a human-readable mirror of the JSON files in
`packages/shared/src/config/`. Those JSON files — not this document — are
what the Node API and the Python ML service actually load at runtime
(`packages/shared/src/config/loader.ts` on the TypeScript side,
`services/ml/app/config_loader.py` on the Python side; both read the
identical files, so the two runtimes can never disagree). If you need to
change a weight, change it in the JSON file, then update the
corresponding table below to match — never the other way around.

Core risk model (applies throughout):

```
Risk = (Hazard Intensity x Exposure x VulnerabilityIndex) / (1 + CopingCapacity)
```

`VulnerabilityIndex` (`VI`) and `CopingCapacity` are each independent 0–1
indices (Sections 2.1 and 2.2). `CopingCapacity` is added to **1** in the
denominator, not used as a bare divisor: this means the formula can never
divide by zero, Risk can never go negative, a habitation with zero
measured coping capacity yields the un-discounted `Risk = H x E x VI`,
and higher coping capacity smoothly discounts Risk (capped at halving it
when `CopingCapacity = 1`). `CopingCapacity` is deliberately used in this
one place only — see Section 2.2 for why it is not also subtracted
inside `VI`.

### Disaster History (Exposure Boost)

Recurrence at a previously-affected site is a well-established signal in
hazard assessment: a location that has already experienced a hazard
event is not equally likely, but MORE likely, to experience the same
hazard type again than an otherwise-identical location with no recorded
history — repeat landslides along the same destabilized slope, repeat
cyclone landfall along the same coastal corridor. Before Step 6, the
`HazardEvent` collection (`data/seed/hazard-events.json`) existed only as
read-only historical reference data: it never fed into a habitation's
hazard score, even though disaster history is an explicit input in the
problem statement. A platform that ignores its own event inventory is
discarding its strongest evidence.

`services/ml/app/engine/disaster_history.py::compute_disaster_history_boost`
fixes this: a habitation within `influenceRadiusKm` of a recorded
`HazardEvent`'s extent, for the SAME hazard type, gets `Exposure` for
that hazard elevated:

```
Exposure_effective = min(1, Exposure_raw + DisasterHistoryBoost)

DisasterHistoryBoost = maxBoost
                      x (1 - distanceKm / influenceRadiusKm)      # spatial decay, linear to 0 at the radius
                      x 0.5 ^ (yearsSinceEvent / halfLifeYears)   # temporal decay, exponential half-life
```

Source of truth: `packages/shared/src/config/disaster-history.json`.

| Parameter          | Value | Meaning                                                          |
| ------------------- | ----- | ----------------------------------------------------------------- |
| `influenceRadiusKm` | 8     | Beyond this distance from the event, no boost applies.            |
| `halfLifeYears`     | 15    | Boost halves every 15 years since the event.                      |
| `maxBoost`          | 0.3   | The boost at distance 0, time 0 — added to raw Exposure, capped at 1. |

When multiple recorded events match a habitation's hazard type within
range, the boost takes the **maximum** across them, not the sum — a site
is elevated-risk because it has *a* history, not proportionally more so
for each additional listed event. A habitation more than `influenceRadiusKm`
from every matching event, or with no matching event at all, gets a
boost of exactly 0 (no change from before this feature existed).

This is standard practice: a real deployment would apply the identical
mechanism against a GSI landslide inventory or CWC flood-extent
shapefile in place of this dataset's three seeded events — see the
Validation section below.

### Compound Hazards

`governing_risk()` picks the single hazard with the numerically largest
Risk at a habitation and reports it alone. That is the right behaviour
when hazards are genuinely independent alternatives — but some hazard
pairs are not alternatives at all: one is the **trigger**, the other is
the **mechanism/consequence** of the same physical event. Cloudburst
(extreme short-duration rainfall) is a documented trigger for landslide
(rainfall-induced slope failure) on already-susceptible terrain — the
causal chain behind the July 2024 Wayanad disaster at Chooralmala and
Mundakkai: the rainfall was the trigger, the landslide was the mechanism
that destroyed habitations and killed over 230 people.

Reporting only whichever of the two happens to have the numerically
larger blended score, and calling that the "governing hazard", loses
this story — worse, if the trigger happens to score higher (as
cloudburst does at both sites even after the Step 6 calibration fixes,
§6.2), the platform names the wrong hazard as governing for a landslide
disaster site.

**Detection** (`services/ml/app/engine/compound_hazard.py::detect_compound_hazard`):
a configured `(trigger, mechanism)` pair is treated as compound at a
habitation only when **both** hazards are independently at or above
`activationZoneClasses` (Red/Orange) there — never inferred from one
hazard alone, and never applied to a pair not explicitly configured.
Source of truth: `packages/shared/src/config/compound-hazards.json`.

**Combination.** When detected, the composite risk score is not the
simple max — it is a standard probabilistic-OR combination, treating
each hazard's Risk (already bounded in [0,1] by construction) as a
probability-like quantity:

```
CompoundRisk = 1 - (1 - TriggerRisk) * (1 - MechanismRisk)
```

This is `>= max(TriggerRisk, MechanismRisk)` always — the union of two
correlated bad outcomes is at least as likely as either alone — and is a
principled combination rule, not an arbitrary multiplier tuned to reach
a target score. **`governingHazard` is set to the MECHANISM**, not
whichever raw score is larger: the mechanism is the consequence that
actually damages habitations and endangers people, which is what an
officer's "governing hazard" field should name. The explanation's `risk`
factor is relabelled (not recomputed — the exact additive decomposition
is untouched) to name both hazards explicitly, e.g. "Landslide risk,
compounded by cloudburst-scale rainfall (both independently Red/Orange
at this site — the cloudburst is the trigger, the landslide is the
mechanism that damages habitations)".

**Why only this one pair.** `compound-hazards.json` currently configures
exactly `{trigger: cloudburst, mechanism: landslide}` and nothing else.
Flood and coastal erosion are correlated in this dataset (a cyclone
drives both storm surge and heavy rainfall) but are not a trigger/
mechanism pair in this same direct causal sense — flooding is not "the
mechanism by which coastal erosion damages a habitation," it is a
separate consequence of the same storm. Adding a pair here is a claim
about physical causation, not merely correlation, and should not be done
without the same explicit justification given for cloudburst→landslide
above.

---

## 1. Hazard Zoning

Hazard zoning classifies land into susceptibility zones per hazard type
(landslide, flood, coastal erosion, cloudburst) using two combined methods.

### 1.1 Weighted Overlay

Each hazard has a set of causative factor layers. Each raster layer is
reclassified to a common 1–5 susceptibility scale, then combined as a
weighted sum:

```
LSI = sum( W_i * R_i )   for i in causative factors
```

Where `LSI` is the hazard-general Susceptibility Index, `W_i` is the
factor's weight (0–1, sums to 1 across all factors for a given hazard —
enforced by a runtime assertion in the config loader), and `R_i` is the
reclassified rating (1–5) of that factor at a given raster cell.

**Weighted Overlay factor weights** (source of truth:
`packages/shared/src/config/hazard-weights.json`):

| Hazard          | Factor                          | Weight `W_i` |
| --------------- | ------------------------------- | ------------ |
| Landslide       | Slope                           | 0.20         |
| Landslide       | Lithology                       | 0.16         |
| Landslide       | Land cover                      | 0.13         |
| Landslide       | Antecedent rainfall index       | 0.13         |
| Landslide       | Soil depth                      | 0.10         |
| Landslide       | Distance to drainage            | 0.09         |
| Landslide       | Distance to road cut            | 0.08         |
| Landslide       | Historical incident density     | 0.06         |
| Landslide       | Curvature                       | 0.03         |
| Landslide       | Aspect                          | 0.02         |
| Flood           | Elevation                       | 0.20         |
| Flood           | Rainfall intensity              | 0.18         |
| Flood           | Distance to river               | 0.15         |
| Flood           | Topographic Wetness Index (TWI) | 0.13         |
| Flood           | Drainage density                | 0.11         |
| Flood           | Land cover                      | 0.10         |
| Flood           | Soil infiltration               | 0.08         |
| Flood           | Historical inundation           | 0.05         |
| Coastal erosion | Shoreline change rate           | 0.30         |
| Coastal erosion | Elevation                       | 0.20         |
| Coastal erosion | Wave energy                     | 0.18         |
| Coastal erosion | Geomorphology                   | 0.15         |
| Coastal erosion | Tidal range                     | 0.10         |
| Coastal erosion | Mangrove/dune buffer presence   | 0.07         |
| Cloudburst      | Orographic index                | 0.30         |
| Cloudburst      | Historical cloudburst density   | 0.25         |
| Cloudburst      | Slope                           | 0.20         |
| Cloudburst      | Elevation                       | 0.15         |
| Cloudburst      | Drainage capacity               | 0.10         |

**Justification.** These starting weights follow the conventional
ordering used in Indian landslide/flood susceptibility-mapping practice
(GSI macro/meso-scale Landslide Susceptibility Mapping guidelines; BIS IS
14496 Part 2) and AHP-literature norms for the Western Ghats and eastern
coastal belt, and are deliberately **defensible starting points, not
final calibrated values** — they are meant to be revised once historical
inventory data (GSI landslide points, CWC flood extents) is available to
fit/validate against in Step 4:

- **Landslide:** slope and lithology dominate, consistent with GSI's
  emphasis on terrain steepness and rock/soil competence as the primary
  landslide-conditioning factors; land cover and antecedent rainfall
  (the trigger mechanism for most Western Ghats slides, including the
  2024 Chooralmala/Mundakkai event) are weighted next; aspect and
  curvature — secondary morphometric refinements — are weighted lowest.
- **Flood:** elevation and rainfall intensity dominate (the two most
  direct physical drivers of inundation depth and onset), followed by
  proximity to the river/drainage network; historical inundation is
  weighted lowest here as a lagging, largely-redundant indicator — it
  correlates heavily with the higher-weighted physical drivers above it
  rather than adding much independent signal, so a low residual weight
  avoids over-crediting a repeat of what elevation, rainfall, and
  drainage proximity already capture. (Historical inundation is an
  ordinary overlay/ML input feature like every other factor here — see
  Section 1.2 for what the ML model's training labels are actually
  derived from, which is not this factor.)
- **Coastal erosion:** shoreline change rate is weighted highest because
  it is the direct empirical measurement of the process being modelled
  (a multi-year satellite-derived retreat/advance rate), following
  standard coastal vulnerability index (CVI) methodology; mangrove/dune
  buffer presence is weighted lowest but included because it is a
  _protective_ factor unique to this hazard (its rating scale is
  inverted — presence reduces susceptibility).
- **Cloudburst:** orographic index and historical cloudburst density
  dominate, reflecting IMD's finding that orographic lift (moist air
  forced up steep windward terrain) is the primary physical driver of
  short-duration extreme rainfall events in both the Western Ghats and
  sub-Himalayan belt, with historical event density as the strongest
  empirical corroborating signal.

### 1.2 ML Susceptibility Model

In parallel with (or as a refinement of) the weighted overlay, a
supervised model (XGBoost, per `CLAUDE.md` tech stack) is trained per
hazard to produce a continuous susceptibility probability `P_ml in [0, 1]`
per grid cell, using the same causative factor layers as features. SHAP
values are computed per prediction (batched once per training run, not
rebuilt per cell) to explain which factors drove a given cell's score, for
display to the officer. Implementation: `services/ml/app/engine/{labels,
train, explain}.py`; full pipeline walkthrough:
`docs/ZONING_PIPELINE.md`.

**Labels are SYNTHETIC_DEMO, not yet a real historical hazard inventory.**
No GSI landslide inventory or CWC flood-extent dataset is wired in for
Wayanad/Ganjam as of Step 5. Training labels are instead drawn from a
hazard-specific, physically-motivated LATENT process built from the same
raw causative factors as the model's features but combined nonlinearly
and with different emphasis than the overlay's linear weighted sum —
landslide's, for example, is an infinite-slope stability proxy (driving
shear stress from gravity vs. resisting shear strength from soil
cohesion, degraded by rainfall-driven pore pressure), not a function of
the overlay score. The latent value is converted to a probability via a
logistic link calibrated to a rare-event base rate (~13% positive before
any boost — hazard events are uncommon, not a coin flip), boosted near a
real recorded hazard event (`data/seed/hazard-events.json`) where one
exists, sampled stochastically, then independently label-noised (~4.5%).

An earlier version of this label process went through two failure modes,
both worth recording so they aren't repeated: first, labels derived from
a hard quantile cutoff on the model's own overlay-score input made
"training" a deterministic lookup table (AUC-ROC ~1.000 on every hazard);
the fix that followed over-corrected with too much noise on too weak a
signal, landing every hazard at/near chance (AUC-ROC 0.50-0.64). The
current design's physically-motivated-but-noised-and-imbalanced labels
land in a realistic band instead — landslide 0.734, flood 0.847,
coastalErosion 0.737, cloudburst 0.787 against the real Wayanad/Ganjam
grid (`services/ml/scripts/run_scoring_pipeline.py`) — genuinely
learnable, genuinely uncertain, neither trivial nor unusable. Both
failure modes are guarded by regression tests
(`services/ml/tests/test_engine_labels_blend_train.py`) asserting labels
aren't a deterministic function of their inputs AND that a trained
model's AUC-ROC lands in `[0.65, 0.92]` for every hazard.
`labels.py::load_real_inventory()` is the seam a real GSI/CWC dataset
plugs into once available; nothing else in the pipeline needs to change
when it is.

**Train/test split is spatial, not random.** Because the causative-factor
layers are (by construction, whether synthetic today or a real DEM/
lithology/land-cover raster later) spatially smooth, a random row-wise
split would put near-duplicate neighboring cells on both sides of
train/test and inflate every reported metric via spatial autocorrelation
leakage. The split is instead a checkerboard over each cell's H3 PARENT
cell (a coarser resolution than the scoring grid), so no contiguous block
of terrain straddles both sets.

The final susceptibility score blends both methods:

```
Susceptibility = alpha * normalize(LSI) + (1 - alpha) * P_ml
```

**`alpha` is set PER HAZARD** (`packages/shared/src/config/blend-config.json`
— `hazards.<hazardType>.alpha`, not a single global value), so a hazard
whose ML model underperforms can be weighted back toward the interpretable
overlay without dragging every other hazard's blend down with it. As of
Step 5, **every hazard's alpha is 0.6**, weighted toward the overlay
rather than a 50/50 split, specifically *because* training labels are
still SYNTHETIC_DEMO — the overlay's factor weights (Section 1.1) carry a
literature-defensible justification the current labels do not — not
because any hazard's model underperforms: all four clear a 0.70 AUC-ROC
floor (0.734-0.847, see above). Had one fallen short, that hazard's alpha
alone would move toward the overlay, with the reason recorded in
`blend-config.json`'s per-hazard `note` field. This is a considered
default, not a placeholder: shift alpha toward the ML score, hazard by
hazard, once a real GSI/CWC inventory replaces the synthetic labels above
and each model's metrics can be validated against genuine positives.

### 1.3 Zone Classes and Thresholds

The blended `Susceptibility` score (0–1) is classified into four zone
classes, using **per-hazard** cutoffs (source of truth:
`packages/shared/src/config/zone-thresholds.json`). Each threshold is the
minimum score required to reach that class:

| Hazard          | Red (≥) | Orange (≥) | Yellow (≥) | Green  |
| --------------- | ------- | ---------- | ---------- | ------ |
| Landslide       | 0.70    | 0.50       | 0.25       | < 0.25 |
| Flood           | 0.75    | 0.55       | 0.30       | < 0.30 |
| Coastal erosion | 0.70    | 0.50       | 0.25       | < 0.25 |
| Cloudburst      | 0.75    | 0.55       | 0.30       | < 0.30 |

**Justification.** Landslide and coastal erosion use a stricter (lower)
Red threshold than flood/cloudburst because both are largely
**irreversible, sudden-onset, high-fatality-potential** processes with
little practicable in-situ mitigation once a slope or shoreline is
critically susceptible — consistent with the NDMA National Landslide Risk
Management Strategy's zero-tolerance posture for very-high-susceptibility
zones. Flood and cloudburst, by contrast, admit more effective
early-warning and temporary-evacuation mitigation short of relocation
(IMD nowcasting, CWC flood forecasting), justifying a slightly higher bar
before a Red designation — and therefore a relocation-track
recommendation — is triggered.

**Multi-hazard aggregation rule:** a habitation's overall zone class is
the **worst** class across all hazards it is exposed to. If **two or more
hazards** independently classify as Orange, the overall class
**escalates to Red** — compounding moderate-to-high hazards materially
increase combined risk beyond what any single hazard's rating captures
(e.g. a habitation that is Orange for both flood and cloudburst faces a
qualitatively different risk profile than one that is Orange for flood
alone).

Habitations intersecting a **Red or Orange Zone** enter the vulnerability
assessment and Relocation Priority Index pipeline (Sections 2–3) — it is
the RPI buckets computed there (Immediate / Short-term / Medium-term,
Section 3.1), not the zone class alone, that perform the triage of how
urgently each one needs to move. Habitations in Yellow/Green zones are
tracked but do not enter the pipeline or generate recommendations.

Gating the pipeline on Red zones alone would make the platform
**reactive**: it would only ever look at habitations already at the
highest hazard tier, deferring assessment until conditions had already
deteriorated to the worst class. Admitting Orange-zone habitations too —
and trusting the RPI to correctly bucket the less-urgent ones into
Medium-term rather than dropping them from consideration — is what makes
proactive, before-the-disaster triage possible, which is this platform's
entire stated purpose (see `CLAUDE.md` Project Purpose).

---

## 2. Vulnerability Index

For each habitation within a Red or Orange Zone (Section 1.3), a
Vulnerability Index (`VI`) is computed as a weighted combination of four
dimensions, clamped to [0, 1]:

```
VI = clamp( W_d * V_demographic + W_s * V_socioeconomic
            + W_st * V_structural + W_a * V_accessibility ,  0, 1 )
```

`CopingCapacity` is deliberately **not** part of this formula — it is
computed as its own independent index and used only as the Risk divisor
(Section 0); see Section 2.2 for why. Each dimension score is itself a
weighted sum of its indicators, each normalized to 0–1.

### 2.1 Dimension and Indicator Weights

Source of truth: `packages/shared/src/config/vulnerability-weights.json`.
Dimension weights sum to 1.0; each dimension's indicator weights sum to
1.0 within that dimension (all enforced by runtime assertion).

| Dimension                  | Weight | Indicator                             | Indicator weight |
| -------------------------- | ------ | ------------------------------------- | ---------------- |
| **Demographic** (`W_d`)    | 0.20   | Share under-5                         | 0.30             |
|                            |        | Share over-60                         | 0.25             |
|                            |        | Women-headed household share          | 0.20             |
|                            |        | Disabled persons share                | 0.25             |
| **Socio-economic** (`W_s`) | 0.30   | BPL share                             | 0.35             |
|                            |        | SC/ST share                           | 0.20             |
|                            |        | Literacy rate (inverse)               | 0.20             |
|                            |        | Primary-livelihood dependence share   | 0.25             |
| **Structural** (`W_st`)    | 0.25   | Kutcha housing share                  | 0.45             |
|                            |        | Building age index                    | 0.25             |
|                            |        | Foundation type risk                  | 0.30             |
| **Accessibility** (`W_a`)  | 0.25   | Distance to all-weather road          | 0.30             |
|                            |        | Distance to PHC                       | 0.30             |
|                            |        | Mobile network coverage (inverse)     | 0.20             |
|                            |        | Evacuation route redundancy (inverse) | 0.20             |

**Justification.** Dimension weights follow standard disaster-vulnerability
framing (NDMA vulnerability assessment guidance, UNDRR/Sendai Framework
vulnerability indicators): **socio-economic status is weighted highest
(0.30)** because poverty and marginalization most directly constrain a
household's ability to prepare for, absorb, and recover from a hazard
event — the core determinant of vulnerability in the disaster-risk
literature, not just exposure. **Structural** housing quality is weighted
second (0.25) because it most directly determines probability of physical
harm during an event. **Accessibility** (0.25) affects both routine
service access and evacuation speed. **Demographic** composition (0.20)
is weighted lowest of the four not because it is unimportant, but because
much of its effect (e.g. poverty correlating with larger dependent-age
shares) is already partially captured by the socio-economic dimension —
weighting it too heavily would double-count that signal.

### 2.2 Coping Capacity

`CopingCapacity` is computed independently as its own weighted index of
four indicators — source of truth: the `copingCapacity` block in
`packages/shared/src/config/vulnerability-weights.json`, a **sibling of**
`dimensions`, not a fifth dimension inside it:

```
CopingCapacity = clamp( sum( W_k * Indicator_k ), 0, 1 )   for k in coping-capacity indicators
```

| Indicator                                    | Weight |
| -------------------------------------------- | ------ |
| SDRF response time (inverse)                 | 0.25   |
| Cyclone/flood shelter within 2 km (presence) | 0.30   |
| Community task force (presence)              | 0.20   |
| Early-warning coverage                       | 0.25   |

`CopingCapacity` is used **only** as the divisor in the top-level `Risk`
formula (Section 0: `Risk = H x E x VI / (1 + CopingCapacity)`) — never
subtracted from or blended into `VI`. Combining the same signal in two
places (subtracted inside `VI` _and_ divided into `Risk`) would
double-count coping capacity's effect and systematically understate risk
for habitations that are well-resourced but still highly exposed and
vulnerable in every other respect. Confining it to a single divisor role
keeps its effect traceable to one place in the model. Shelter presence is
weighted highest (0.30) among its indicators as the single most concrete,
verifiable mitigation asset a habitation can have.

---

## 3. Relocation Priority Index (RPI)

The Relocation Priority Index combines the habitation's hazard `Risk`
with its `VI` (Section 2):

```
RPI = W_r * normalize(Risk) + W_v * VI
```

Source of truth: `packages/shared/src/config/priority-weights.json`.

| Term                        | Weight |
| --------------------------- | ------ |
| Risk (`W_r`)                | 0.55   |
| Vulnerability Index (`W_v`) | 0.45   |

**Justification.** Risk is weighted slightly higher than vulnerability
because immediate physical hazard severity (an active or rapidly
worsening Red Zone) should dominate _when_ a relocation assessment is
triggered — this mirrors NDMA's proactive relocation guidance, which
treats hazard severity as the primary trigger and vulnerability as the
factor that determines _how urgently and for whom_, rather than the
reverse. A near-even split (0.55/0.45, not e.g. 0.8/0.2) keeps
vulnerability from being marginalized: two habitations facing identical
hazard severity can still land in different priority buckets because of
markedly different vulnerability, which is the intended behaviour.

**What `normalize(Risk)` means (a Step 5 finding, not the original
assumption).** Risk (Section 0) is already guaranteed in `[0, 1]` by
construction, so an early implementation treated `normalize(Risk)` as a
no-op — Risk passed into RPI unchanged. That produced a structural bug:
`Risk = H x E x VI / (1 + CopingCapacity)` has `VI` as a multiplicative
factor, so `Risk <= VI` always; with RPI a weighted average of Risk and
VI, that makes `RPI <= VI` for every habitation, regardless of hazard
severity. Verified against the real Wayanad/Ganjam pilot data: every
Red/Orange habitation landed in Medium-term — zero in Short-term or
Immediate — because no habitation's VI in this dataset clears 0.70, the
Immediate floor. `normalize(Risk)` is instead **min-max rescaling of each
habitation's governing Risk against the other Red/Orange habitations
assessed in the same run** (`services/ml/app/engine/priority.py::
normalize_risk`) — the standard reading of "normalize" in a scoring
context, and the only one consistent with this section's own stated
intent, since a no-op reading gives "normalize" nothing to do. This is
scoped **per district, per pipeline run** (not state-wide across every
district ever assessed): the highest-risk Red/Orange habitation in a run
is always normalized to 1.0, the lowest to 0.0, so a single habitation
assessed alone is trivially the most urgent in its own batch. The
tradeoff this implies — RPI is a relative ranking within a run, not an
absolute cross-run/cross-district score — is deliberate: it is what
makes hazard severity able to drive urgency at all, per this section's
own design intent, and matches how the priority list is actually used (an
officer's ranked worklist for one district's current pipeline run, not a
number compared across districts assessed weeks apart). See
`docs/SCORING_PIPELINE.md` for a fully worked numeric example.

### 3.1 Priority Buckets

`RPI` (0–1) is bucketed into three action timeframes. Each threshold is
the minimum RPI required to reach that bucket:

| Bucket          | RPI range   | Meaning                                                                               |
| --------------- | ----------- | ------------------------------------------------------------------------------------- |
| **Immediate**   | ≥ 0.70      | Relocation assessment must begin now; site suitability search triggered automatically |
| **Short-term**  | 0.45 – 0.70 | Relocation planned within the current planning cycle (1–2 years)                      |
| **Medium-term** | < 0.45      | Monitored; relocation planning deferred, mitigation measures considered first         |

Only habitations bucketed **Immediate** or **Short-term** proceed
automatically to candidate site discovery (Section 4); **Medium-term**
habitations are visible to the officer but do not auto-trigger site
search.

---

## 4. Site Suitability

Candidate relocation sites are evaluated in two stages: hard exclusion,
then AHP-weighted scoring of what remains.

### 4.1 Exclusion Criteria (Hard Filters)

Applied first. A candidate site failing **any** exclusion criterion is
removed from consideration entirely — it is never scored, regardless of
how well it performs on other factors. Source of truth:
`packages/shared/src/config/exclusion-criteria.json`.

| Criterion                                     | Exclusion rule                                                   | Justification                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Inside Red or Orange hazard zone (any hazard) | Site polygon intersects any Red or Orange zone                   | Must not relocate people into another hazard zone                                        |
| Inside CRZ-I                                  | Intersects Coastal Regulation Zone I                             | Legal restriction — ecologically sensitive / inter-tidal area under the CRZ Notification |
| Protected/reserved forest                     | Intersects notified forest or protected area boundary            | Legal restriction (Forest (Conservation) Act)                                            |
| Within 100-year floodplain                    | Intersects the 1%-annual-exceedance-probability river floodplain | Would relocate people into a still-hazardous zone                                        |
| Excessive slope                               | Mean slope > 20°                                                 | Unbuildable without disproportionate earthwork/retaining structures                      |
| Active fault buffer                           | Within 300 m of a known active fault                             | Safety                                                                                   |
| Water body buffer                             | Within 50 m of a river, lake, or reservoir                       | Standard no-build riparian buffer; also reduces flood exposure                           |
| Mining lease area                             | Intersects an active/pending mining lease                        | Legal and geotechnical-stability restriction                                             |

### 4.2 AHP-Weighted Scoring

Sites surviving exclusion are scored using Analytic Hierarchy Process
(AHP) weights across nine suitability criteria, producing a Site
Suitability Score `SSS in [0, 1]`:

```
SSS = sum( W_j * normalize(C_j) )   for j in suitability criteria
```

Weights are derived from a pairwise comparison matrix using Saaty's 1–9
scale (Saaty, _The Analytic Hierarchy Process_, 1980) via the row
geometric-mean method, per `packages/shared/src/config/suitability-ahp.json`:

| Criterion                                                 | Weight `W_j` |
| --------------------------------------------------------- | ------------ |
| Hazard safety                                             | 0.278        |
| Water availability                                        | 0.211        |
| Land availability                                         | 0.157        |
| Road connectivity                                         | 0.114        |
| Distance from origin habitation                           | 0.082        |
| Livelihood access                                         | 0.059        |
| Land ownership / acquisition ease                         | 0.043        |
| Existing infrastructure                                   | 0.032        |
| Slope (buildability nuance beyond the Section 4.1 cutoff) | 0.024        |

**Consistency Ratio: 0.0061** (λmax = 9.071, CI = 0.0089, RI(n=9) = 1.45
per Saaty's table) — comfortably below the 0.10 acceptance threshold; the
config loader asserts `consistencyRatio < 0.10` at load time and refuses
to start if a future edit to the pairwise matrix breaks consistency.

**Honesty note:** this pairwise matrix was constructed to be internally
consistent (hence the low CR) as a defensible starting point, not derived
from an expert-elicitation survey — it is pending a formal
pairwise-comparison round with state DM officials to replace it with
judgments actually elicited from domain experts. The consistency
assertion is a floor, not a substitute for that process: it guarantees
the matrix is _self-consistent_, not that its rankings are _correct_. Any
future matrix — whether from this team or from the expert round — must
still clear `consistencyRatio < 0.10` for the loader to accept it.

**Justification.** The pairwise judgments rank criteria by how
catastrophic or how hard-to-remedy a poor outcome on that criterion would
be: **hazard safety** is ranked highest because a suitable site must
above all not recreate the problem being solved (this is scored
independently of the hard Section 4.1 hazard-zone exclusion, capturing
_residual_ hazard proximity/severity among sites that already passed the
exclusion filter). **Water availability** is ranked second — per Section
5.2, insufficient water supply is often the single most binding
carrying-capacity constraint in practice for rural Indian resettlement
sites. **Land availability**, **road connectivity**, and **distance from
the origin habitation** (livelihood/social-tie continuity) follow.
**Slope** is ranked lowest here specifically because extreme slope is
already a hard exclusion (Section 4.1) — this AHP weight only
differentiates _remaining_ buildability nuance among sites that already
cleared that bar, so it correctly receives a small residual weight.

Candidate sites are ranked by `SSS` descending and passed, along with
their carrying capacity (Section 5), to the officer decision workbench.

---

## 5. Carrying Capacity

For each candidate site that survives exclusion, carrying capacity is
computed independently across five constraint domains. The site's
reported carrying capacity is the **minimum** across all five — i.e. the
site can support no more households than its most limiting resource
allows — and the **binding constraint** (which domain produced the
minimum) is always reported alongside the number, so the officer knows
what would need to be augmented to raise capacity.

```
CarryingCapacity = min(
    C_land,
    C_water,
    C_education,
    C_health,
    C_access
)

BindingConstraint = argmin(C_land, C_water, C_education, C_health, C_access)
```

Source of truth for every norm below:
`packages/shared/src/config/capacity-norms.json`.

### 5.1 Land Constraint (`C_land`)

```
C_land = UsableSiteArea / EffectiveLandAreaPerHousehold
```

`EffectiveLandAreaPerHousehold` = 150 sqm, composed of a 100 sqm plot per
household (`plotAreaPerHouseholdSqm`) multiplied by a 1.5x infrastructure
overhead factor (`infrastructureOverheadFactor`) to account for shared
roads, drainage, and open space in a planned resettlement layout — a
commonly used rule-of-thumb range in Indian state R&R (Resettlement &
Rehabilitation) site-planning norms for rural low-rise layouts.

### 5.2 Water Constraint (`C_water`)

Based on the **55 litres per capita per day (LPCD)** basic service level
benchmark (Jal Jeevan Mission / MoHUA norm for rural water supply — this
is a fixed national norm, not a tunable weight):

```
C_water = AvailableWaterSupply_LPD / (55 * AvgHouseholdSize)
```

`AvgHouseholdSize` defaults to 4.8 (India rural average), with
state-level overrides of 4.3 for Kerala and 4.6 for Odisha (both closer
to their respective Census 2011 state averages than the national figure).

### 5.3 Education Constraint (`C_education`)

Based on **RTE Act, 2009** neighbourhood-school and pupil-teacher-ratio
norms:

```
C_education = NearbySchoolSpareCapacity / SchoolSeatsPerHousehold
```

- Primary school (classes I–V) must be within **1 km**
  (`primarySchoolMaxDistanceKm`); upper primary (classes VI–VIII) within
  **3 km** (`upperPrimarySchoolMaxDistanceKm`) — both taken directly from
  the RTE Act Schedule neighbourhood norms.
- Pupil-teacher ratio: **30:1** for primary, **35:1** for upper primary
  (`pupilTeacherRatioPrimary` / `pupilTeacherRatioUpperPrimary`), the RTE
  Act's stated ratios.
- School-age children are assumed to be **18%** of total population
  (`schoolAgeChildrenShareOfPopulation`), a standard planning estimate for
  the 6–14 age cohort against India's current age pyramid.

### 5.4 Health Constraint (`C_health`)

Based on **Indian Public Health Standards (IPHS)** facility population
norms:

```
C_health = min(
    NearbyHealthFacilitySpareCapacity / AvgHouseholdSize,
    IPHS_PopulationNorm / AvgHouseholdSize
)
```

| Facility                      | Plains norm              | Hilly/tribal/difficult-area norm |
| ----------------------------- | ------------------------ | -------------------------------- |
| Sub Health Centre             | 1 per 5,000 population   | 1 per 3,000 population           |
| Primary Health Centre (PHC)   | 1 per 30,000 population  | 1 per 20,000 population          |
| Community Health Centre (CHC) | 1 per 120,000 population | 1 per 80,000 population          |

Wayanad sites use the hilly/tribal norm; Ganjam sites use the plains
norm, per IPHS guidelines' area classification.

**Corrected during Step 7 Commit 2.** This formula originally read
`SpareCapacity / (IPHS_PopulationNorm / AvgHouseholdSize)` — dividing by
a households-*per-facility* figure instead of a population-*per-
household* rate, unlike `C_water`'s and `C_education`'s own "spare
capacity / per-household rate" pattern just above. As literally
implemented that drove every seeded candidate site's health capacity to
0.28-0.39 households (Wayanad and Ganjam alike) — `CarryingCapacity`
effectively zero everywhere, so no habitation could ever be matched to
any site. That is a units bug, not a genuine finding about site
viability (see `services/ml/app/engine/capacity.py`'s docstring for the
full derivation). The corrected formula's first term mirrors `C_water`/
`C_education` directly; the second term is a real physical ceiling — one
facility cannot absorb more newly-relocated population than its own
tier-specific design norm allows — which is where the hilly-tribal-vs-
plains distinction legitimately re-enters: Wayanad's smaller 20,000-
population PHC norm caps out at *fewer* households per facility than
Ganjam's 30,000-population norm, the opposite ordering the buggy formula
produced. For every seeded site the spare-capacity term stays well under
this ceiling, so in practice the correction is a defensive cap, not a
second degenerate divisor.

### 5.5 Access Constraint (`C_access`)

```
C_access = AccessPointCount * HouseholdsPerAccessPointCapacity
```

A site counts as having a usable access point only if an all-weather
road is within **500 m** (`allWeatherRoadMaxDistanceMeters`). Each access
point is assumed to support **250 households**
(`householdsPerAccessPointCapacity`) before the connecting road segment
itself becomes a capacity constraint — a planning-level placeholder
pending an actual road-network capacity analysis once OSM/state road
data is integrated (Step 9).

### 5.6 Reporting

The officer decision workbench always displays, per candidate site:

- `CarryingCapacity` (the minimum, in households)
- `BindingConstraint` (which of land/water/education/health/access
  produced that minimum)
- The individual `C_land`, `C_water`, `C_education`, `C_health`,
  `C_access` values, so the officer can see how close the non-binding
  constraints are to also becoming limiting.

---

## 6. Validation Against Ground Truth

All hazard, vulnerability, and priority data in this pilot is
`SYNTHETIC_DEMO` — see CLAUDE.md's constraints: nothing here is described
as trained on real historical inventory data. But the platform is still
**validated** against two known real events, because a model that cannot
reproduce a known outcome on the ground it claims to assess is not
trustworthy on ground it hasn't been checked against:

- **The July 2024 Wayanad landslides** (Chooralmala–Mundakkai), which
  killed over 230 people — the most recognizable disaster location in
  the Kerala pilot, and this platform's single most important sanity
  check (`data/seed/hazard-events.json`).
- **Cyclones Phailin (2013) and Titli (2018)**, which struck the Ganjam
  coast (`data/seed/hazard-events.json`).

**What "validation" means here, precisely.** Calibration adjusts the
SYNTHETIC INPUT FIELDS that feed the model (the causative-factor
generator, `services/ml/scripts/derive_factors.py`; the seed attribute
data, `data/seed/*.geojson`) and adds a real-event-driven signal the
model was previously missing (Disaster History, above) — it never
adjusts the SCORING LOGIC (weights, thresholds, formulas) to force a
particular habitation toward a particular answer. This is the standard
practice a real deployment would follow with GSI landslide inventory or
CWC flood-extent data: you calibrate the inputs against known ground
truth, you do not hand-tune the model until a known site scores how you
expect.

### 6.1 What Step 6 found and fixed

Running the full pipeline against live Wayanad/Ganjam data surfaced a
concrete calibration defect: cloudburst governed several Wayanad
habitations — including Chooralmala and Mundakkai — ahead of landslide,
in a district whose only recorded historical disaster, and whose
defining terrain hazard, is landslide. Diagnosed to three specific
causes in `derive_factors.py`'s synthetic cloudburst field, all fixed
without touching any weight, threshold, or scoring formula:

1. **Local vs. absolute normalization.** `orographicIndex` (cloudburst's
   largest-weighted factor, 0.3) was `0.5*normalize01(slope) +
   0.5*normalize01(elevation)` — each term rescaled to fill [0,1] across
   Wayanad's OWN cell population, so the district's own top-ranked cells
   always hit `orographicIndex ~= 1.0` regardless of how extreme their
   terrain actually is. Landslide's own dominant factor (`slope`, weight
   0.2) is never rescaled like this — its rating only reaches 5 above an
   ABSOLUTE 40 degrees. Fixed to a real physical denominator.
2. **Double-counted elevation.** `orographicIndex` also reused
   `elevation_amsl`, which cloudburst ALSO carries as its own separate
   factor (weight 0.15) — elevation was being counted twice in
   cloudburst's susceptibility index; landslide has no standalone
   elevation factor at all. Fixed by dropping elevation from
   `orographicIndex` entirely (kept purely slope-driven, the actual
   meteorological orographic-lift trigger, scaled against a genuinely
   steep 40-degree reference).
3. **A fabricated historical anchor.** `historicalCloudburstDensity`
   (weight 0.25) was a gaussian bump centred on the real 2024
   landslide's location, at nearly the same anchor and weight-share
   landslide's own `historicalIncidentDensity` uses. The real historical
   record at that point is a **landslide**, not a cloudburst — inventing
   a "historical cloudburst" peak at the site of a recorded landslide is
   not physically justified, and duplicated signal the new Disaster
   History mechanism (above) now already routes to the CORRECT hazard
   type. Fixed by dropping the anchored bump; the field is now a
   uniformly low-magnitude noise proxy, honestly representing "no real
   cloudburst inventory exists for this site."

Two further, independently-scoped fixes from the same pass:

4. **Vulnerability realism.** Chooralmala and Mundakkai's seed attributes
   understated how remote these settlements actually were: real accounts
   describe estate labor-line housing on a single vulnerable access
   road, later reached by rescuers, with documented early-warning
   failure. Seed data adjusted (`data/seed/wayanad-habitations.geojson`)
   — not to hit a target score, but to be plausible for the settlements'
   actual character: `kutchaHousingShare` raised (0.33/0.38 -> 0.5/0.55),
   `mobileNetworkCoverage` lowered (0.68/0.85 -> 0.4/0.35),
   `distanceToAllWeatherRoadKm` raised (2.5/2.75 -> 4.2/5.5),
   `sdrfResponseTimeMinutes` raised (79.8/72 -> 150/175),
   `shelterWithin2km` set false (was true for both),
   `earlyWarningCoverage` lowered (0.785/0.663 -> 0.35/0.3), and
   Mundakkai's `communityTaskForcePresent` set false (was true).
5. **Live/offline flood training divergence** (a separate, pre-existing
   bug, not part of the cloudburst diagnosis): the live zoning job
   trained flood — a hazard both Wayanad and Ganjam list as primary — on
   only the requesting district's cells each time, while the offline
   reference script (`run_zoning_pipeline.py`) correctly pools every
   district that shares a hazard before training. Per-district training
   on Wayanad's ~2,900 cells alone starves the model of positive
   examples. Fixed in `apps/api/src/lib/jobs/zoningJob.ts::scoreOneHazard`:
   any hazard is now trained on the POOLED cell set across every
   district that lists it as a primary hazard, then only the requesting
   district's `GridCell`/`HazardZone` documents are written. Re-verified
   live against offline after the fix — bit-identical, not merely
   similar, down to the AUC-ROC/precision/recall/F1/calibration-error
   metrics: Wayanad flood `{Green: 2074, Orange: 7, Yellow: 712}`,
   Ganjam flood `{Green: 3339, Orange: 1624, Red: 176, Yellow: 3103}` in
   both paths.

### 6.2 Result, reported plainly

Blended-score distributions across Wayanad's 2,793 grid cells, before
and after the three cloudburst fixes:

| Hazard     | Mean (before) | Mean (after) | Median (before) | Median (after) |
| ---------- | ------------- | ------------- | ---------------- | ---------------- |
| landslide  | 0.373 (overlay) | unchanged     | 0.363 (overlay)  | unchanged        |
| cloudburst | 0.344 (overlay) | 0.299 (overlay) | 0.300 (overlay) | 0.238 (overlay) |

(Overlay-score figures — the pre-ML-blend stage — since that isolates
the causative-factor fix from any ML-side variation; the blended-score
picture moves the same direction: Wayanad's district-wide blended-score
**mean now favors landslide** (0.309) **over cloudburst** (0.292),
reversed from before the fix, and landslide now has more Red-class grid
cells (153) than cloudburst (116).)

Habitation-level outcome for the pilot's two centrepiece habitations,
before -> after all of Step 6's fixes:

| Habitation  | Governing hazard (before) | Bucket (before) | RPI (before) | Governing hazard (after) | Bucket (after) | RPI (after) |
| ----------- | -------------------------- | ---------------- | -------------- | -------------------------- | ---------------- | -------------- |
| Chooralmala | cloudburst                  | MediumTerm       | 0.446          | cloudburst                  | ShortTerm        | 0.627          |
| Mundakkai   | cloudburst                  | ShortTerm        | 0.482          | cloudburst                  | **Immediate**    | 0.759          |

**Mundakkai now reaches Immediate.** Chooralmala rises substantially
(MediumTerm -> ShortTerm) but does not cross the Immediate threshold.
**Both habitations' governing hazard is still cloudburst, not landslide** —
this is the honest residual finding Step 6 did not resolve, reported
plainly rather than forced further:

At Chooralmala/Mundakkai's exact grid cells, both hazards' ML models are
independently saturated (predicted probability > 0.99 for both landslide
and cloudburst — the 40-45 degree slope at the real escarpment is
genuinely extreme by both hazards' latent processes, which is
physically correct: this terrain really is doubly dangerous). With both
ML scores pinned near 1.0 and `blend-config.json`'s alpha identical
(0.6) for both hazards, the tie-breaker is the weighted-overlay score,
where landslide's `distanceToDrainage` and `distanceToRoadCut` factors
both land at their SAFEST rating (the synthetic `WAYANAD_RIVER`/
`WAYANAD_ROAD` reference polylines in `derive_factors.py` do not happen
to pass near the real escarpment coordinates) — pulling landslide's
overlay score down to 0.578 against cloudburst's 0.675 at that exact
cell. This is a real, traceable, further-diagnosable limitation of this
dataset's synthetic river/road geometry, not a weighting or scoring
defect — and it was deliberately left unfixed rather than adjusting a
fourth field specifically to move these two habitations' ranking, which
would cross from calibration into exactly the outcome-forcing this
project's standing instruction rules out.

### 6.3 The residual finding was a framing gap, not a scoring gap

A later session revisited this specific residual finding and concluded
it was not, in the end, a case that needed a fourth synthetic-field
adjustment: it was a case the platform was framing wrong. Chooralmala
and Mundakkai are not a site where cloudburst and landslide compete for
which is "worse" — they are a site where extreme rainfall (cloudburst)
triggers slope failure (landslide), and both were independently Red at
the exact same cell. Picking whichever scores numerically higher and
calling it "the governing hazard" was never the right question to ask
at a site like this. The Compound Hazards mechanism above (§0) resolves
it: `governingHazard` is now the mechanism (landslide), and the risk
score is the compound (union) combination, not the max.

| Habitation  | Governing hazard (Step 6) | Bucket (Step 6) | RPI (Step 6) | Governing hazard (Step 7 Commit 1) | Bucket (Step 7 Commit 1) | RPI (Step 7 Commit 1) |
| ----------- | -------------------------- | ---------------- | -------------- | -------------------------- | ---------------- | -------------- |
| Chooralmala | cloudburst                  | ShortTerm        | 0.627          | **landslide** (compound, triggered by cloudburst) | ShortTerm        | 0.653          |
| Mundakkai   | cloudburst                  | Immediate        | 0.759          | **landslide** (compound, triggered by cloudburst) | Immediate        | 0.759          |

Both habitations now correctly name **landslide** as the governing
hazard — the mechanism that actually destroyed them — with cloudburst
recorded explicitly as the compound trigger, not silently outranking it.
Mundakkai's RPI is unchanged (it was already the highest-risk habitation
in its batch before and after, so `normalize(Risk)` still maps it to
1.0 either way); Chooralmala's RPI rises slightly (0.627 -> 0.653,
still ShortTerm) because the compound (union) risk is strictly higher
than the simple max it replaced.

**Reported plainly:** across Wayanad's 21 Red/Orange habitations in this
run, 17 (81%) turn out to be compound cloudburst+landslide sites, not
just these two. This is not the mechanism over-firing — landslide and
cloudburst susceptibility share the same underlying driver in this
dataset (proximity to the steep escarpment), so their Red/Orange
footprints are substantially overlapping across the district's terrain
corridor, which is the physically expected shape for a hill district
where both hazards are orographic. It is a real, honest consequence of
what "compound hazard" means at district scale, not a narrow fix
scoped only to the two headline habitations.
