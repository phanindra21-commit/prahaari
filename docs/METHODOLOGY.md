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
Wayanad/Ganjam as of Step 4. Training labels are instead a smooth logistic
function of each cell's own weighted-overlay score, boosted near a real
recorded hazard event (`data/seed/hazard-events.json`) where one exists,
then independently label-noised (12%) so the model has genuine
uncertainty to learn from rather than a deterministic restatement of its
own input features — see `docs/ZONING_PIPELINE.md`'s note on why that
noise step exists and is tested for. `labels.py::load_real_inventory()`
is the seam a real GSI/CWC dataset plugs into once available; nothing else
in the pipeline needs to change when it is.

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

**`alpha = 0.6`** (`packages/shared/src/config/blend-config.json`),
weighted toward the interpretable weighted-overlay rather than a 50/50
split, specifically *because* the ML model's training labels are
SYNTHETIC_DEMO — the overlay's factor weights (Section 1.1) carry a
literature-defensible justification the current labels do not. This is a
considered default, not a placeholder: shift `alpha` toward the ML score
once a real GSI/CWC inventory replaces the synthetic labels above and the
model's metrics can be validated against genuine positives, at which point
the blend weight should track how much more the ML score is actually
adding over the overlay alone.

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
C_health = NearbyHealthFacilitySpareCapacity / (IPHS_PopulationNorm / AvgHouseholdSize)
```

| Facility                      | Plains norm              | Hilly/tribal/difficult-area norm |
| ----------------------------- | ------------------------ | -------------------------------- |
| Sub Health Centre             | 1 per 5,000 population   | 1 per 3,000 population           |
| Primary Health Centre (PHC)   | 1 per 30,000 population  | 1 per 20,000 population          |
| Community Health Centre (CHC) | 1 per 120,000 population | 1 per 80,000 population          |

Wayanad sites use the hilly/tribal norm; Ganjam sites use the plains
norm, per IPHS guidelines' area classification.

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
