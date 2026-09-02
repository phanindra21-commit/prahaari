# Methodology

This document defines the analytical methods behind PunarVas. It is the
specification that `services/ml` implements. Exact weights are left as
clearly-marked `TODO` tables — do not invent weights when implementing;
fill in the tables here first (with a cited justification) and implement
against that.

Core risk model (applies throughout):

```
Risk = (Hazard Intensity x Exposure x Vulnerability) / Coping Capacity
```

---

## 1. Hazard Zoning

Hazard zoning classifies land into susceptibility zones per hazard type
(landslide, flood, coastal erosion, cloudburst) using two combined methods:

### 1.1 Weighted Overlay

Each hazard has a set of causative factor layers (e.g. for landslide:
slope, geology/lithology, land use/land cover, soil, drainage density,
rainfall intensity, distance to fault lines, distance to road cuts). Each
raster layer is reclassified to a common 1–5 susceptibility scale, then
combined as a weighted sum:

```
LSI = sum( W_i * R_i )   for i in causative factors
```

Where `LSI` is the Landslide (or hazard-general) Susceptibility Index,
`W_i` is the factor's weight (0–1, sums to 1 across all factors for a
given hazard), and `R_i` is the reclassified rating (1–5) of that factor
at a given raster cell.

**TODO — Weighted Overlay factor weights (fill in per hazard, cite source
e.g. AHP expert survey / literature):**

| Hazard          | Factor                              | Weight `W_i` | Source/justification |
| --------------- | ----------------------------------- | ------------ | -------------------- |
| Landslide       | Slope                               | TODO         | TODO                 |
| Landslide       | Geology/Lithology                   | TODO         | TODO                 |
| Landslide       | Land use/land cover                 | TODO         | TODO                 |
| Landslide       | Soil type                           | TODO         | TODO                 |
| Landslide       | Drainage density                    | TODO         | TODO                 |
| Landslide       | Rainfall intensity                  | TODO         | TODO                 |
| Landslide       | Distance to faults                  | TODO         | TODO                 |
| Landslide       | Distance to roads                   | TODO         | TODO                 |
| Flood           | Elevation/DEM                       | TODO         | TODO                 |
| Flood           | Distance to river/drainage          | TODO         | TODO                 |
| Flood           | Rainfall intensity                  | TODO         | TODO                 |
| Flood           | Land use/land cover                 | TODO         | TODO                 |
| Flood           | Soil infiltration capacity          | TODO         | TODO                 |
| Coastal erosion | Shoreline change rate               | TODO         | TODO                 |
| Coastal erosion | Coastal elevation                   | TODO         | TODO                 |
| Coastal erosion | Distance from shoreline             | TODO         | TODO                 |
| Coastal erosion | Wave/tidal energy                   | TODO         | TODO                 |
| Cloudburst      | Rainfall intensity (short-duration) | TODO         | TODO                 |
| Cloudburst      | Slope                               | TODO         | TODO                 |
| Cloudburst      | Drainage density                    | TODO         | TODO                 |

### 1.2 ML Susceptibility Model

In parallel with (or as a refinement of) the weighted overlay, a
supervised model (XGBoost, per `CLAUDE.md` tech stack) is trained on
historical hazard inventory points (e.g. GSI landslide inventory, CWC
flood extents — see `docs/DATA_SOURCES.md`) as positive labels, with the
same causative factor layers as features, to produce a continuous
susceptibility probability `P_ml in [0, 1]` per raster cell. SHAP values
are computed per prediction to explain which factors drove a given
cell's score, for display to the officer.

The final susceptibility score blends both methods:

```
Susceptibility = alpha * normalize(LSI) + (1 - alpha) * P_ml
```

**TODO:** `alpha` (blend weight between weighted-overlay and ML score,
0–1) — TODO, to be tuned once historical inventory data is available for
model validation in the pilot districts.

### 1.3 Zone Classes and Thresholds

The blended `Susceptibility` score (0–1, or rescaled 0–100) is classified
into four zone classes:

| Zone Class | Susceptibility range (TODO) | Meaning                                                                                                |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Red**    | TODO (e.g. > 0.75)          | Very high hazard susceptibility — priority for Red Zone designation and relocation assessment pipeline |
| **Orange** | TODO (e.g. 0.50 – 0.75)     | High susceptibility — enhanced monitoring, mitigation works considered before relocation               |
| **Yellow** | TODO (e.g. 0.25 – 0.50)     | Moderate susceptibility — monitored, no immediate action                                               |
| **Green**  | TODO (e.g. < 0.25)          | Low susceptibility — no action                                                                         |

Only habitations intersecting a **Red Zone** enter the vulnerability
assessment and Relocation Priority Index pipeline (Sections 2–3). Habitations
in Orange/Yellow/Green zones are tracked but do not generate relocation
recommendations.

---

## 2. Vulnerability Index

For each habitation within a Red Zone, a Vulnerability Index (`VI`) is
computed as a weighted combination of five component sub-indices, each
normalized to 0–1 (min-max or a documented reference range):

```
VI = W_d * V_demographic + W_s * V_socioeconomic + W_st * V_structural
     + W_a * V_accessibility - W_c * CopingCapacity
```

(Coping capacity subtracts from / divides into vulnerability — see the
core risk formula. Whether it is implemented as a subtracted term or as
the divisor in the top-level `Risk` formula is an implementation choice
to be fixed in Step 6; keep it consistent across the codebase.)

### 2.1 Components

| Component           | Indicators (examples)                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Demographic**     | Population density, % population under 5 or over 65, % population with disability, % female-headed households                                                                   |
| **Socio-economic**  | % below poverty line, literacy rate, % marginalized/scheduled caste or tribe population, primary occupation dependency on hazard-exposed land (e.g. agriculture on floodplain)  |
| **Structural**      | % kutcha (non-permanent) housing, building age, roof/wall material hazard resistance, housing density                                                                           |
| **Accessibility**   | Distance to nearest all-weather road, distance to nearest hospital, distance to nearest evacuation shelter, mobile network / early-warning reach                                |
| **Coping capacity** | Presence of a local disaster management committee, past disaster preparedness training coverage, insurance penetration, savings/access to credit, early-warning system coverage |

**TODO — Vulnerability component weights:**

| Component               | Weight | Source/justification |
| ----------------------- | ------ | -------------------- |
| Demographic (`W_d`)     | TODO   | TODO                 |
| Socio-economic (`W_s`)  | TODO   | TODO                 |
| Structural (`W_st`)     | TODO   | TODO                 |
| Accessibility (`W_a`)   | TODO   | TODO                 |
| Coping capacity (`W_c`) | TODO   | TODO                 |

Weights must sum to 1 across the four positive components (demographic,
socio-economic, structural, accessibility); coping capacity is applied as
a risk-reducing term rather than being pooled into that sum.

---

## 3. Relocation Priority Index (RPI)

The Relocation Priority Index combines the habitation's hazard `Risk`
(Section 0 formula, using the habitation's zone-level hazard intensity
and exposure) with its `VI` (Section 2):

```
RPI = W_r * normalize(Risk) + W_v * VI
```

**TODO — RPI weights:**

| Term                        | Weight | Source/justification |
| --------------------------- | ------ | -------------------- |
| Risk (`W_r`)                | TODO   | TODO                 |
| Vulnerability Index (`W_v`) | TODO   | TODO                 |

### 3.1 Priority Buckets

`RPI` (0–1, or rescaled 0–100) is bucketed into three action timeframes:

| Bucket          | RPI range (TODO)      | Meaning                                                                               |
| --------------- | --------------------- | ------------------------------------------------------------------------------------- |
| **Immediate**   | TODO (e.g. > 0.7)     | Relocation assessment must begin now; site suitability search triggered automatically |
| **Short-term**  | TODO (e.g. 0.4 – 0.7) | Relocation planned within the current planning cycle (e.g. 1–2 years)                 |
| **Medium-term** | TODO (e.g. < 0.4)     | Monitored; relocation planning deferred, mitigation measures considered first         |

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
how well it performs on other factors.

**TODO — Exclusion criteria (fill in exact thresholds):**

| Criterion                                                | Exclusion rule                                                       | Source/justification                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Within existing Red/Orange hazard zone (any hazard type) | TODO (e.g. site polygon intersects any Red or Orange zone)           | Must not relocate people into another hazard zone     |
| Forest land / protected area                             | TODO (e.g. intersects notified forest or protected area boundary)    | Legal restriction                                     |
| Minimum land area                                        | TODO (e.g. < N hectares for target population)                       | Must fit the relocating population at minimum density |
| Slope                                                    | TODO (e.g. > N% slope)                                               | Buildability                                          |
| Distance from active fault / known hazard source         | TODO                                                                 | Safety                                                |
| Legal land ownership status                              | TODO (e.g. disputed title, no clear government/acquirable ownership) | Feasibility of acquisition                            |
| Distance from existing settlement (too far)              | TODO (e.g. > N km, severs livelihood/social ties)                    | Social feasibility                                    |

### 4.2 AHP-Weighted Scoring

Sites surviving exclusion are scored using Analytic Hierarchy Process
(AHP) weights across suitability criteria, producing a Site Suitability
Score `SSS in [0, 1]`:

```
SSS = sum( W_j * normalize(C_j) )   for j in suitability criteria
```

Where each `W_j` is derived from an AHP pairwise-comparison matrix
(consistency ratio must be < 0.1 for the weight set to be accepted).

**TODO — AHP suitability criteria and weights:**

| Criterion                                                | Weight `W_j` | Source/justification |
| -------------------------------------------------------- | ------------ | -------------------- |
| Distance to nearest town/market                          | TODO         | TODO                 |
| Distance to nearest road (connectivity)                  | TODO         | TODO                 |
| Water source proximity                                   | TODO         | TODO                 |
| Land cost/acquirability                                  | TODO         | TODO                 |
| Proximity to original habitation (livelihood continuity) | TODO         | TODO                 |
| Terrain buildability (slope, soil bearing capacity)      | TODO         | TODO                 |
| Existing infrastructure proximity (power, telecom)       | TODO         | TODO                 |

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

### 5.1 Land Constraint (`C_land`)

```
C_land = UsableSiteArea / MinLandAreaPerHousehold
```

**TODO:** `MinLandAreaPerHousehold` (site-planning norm, e.g. sqm per
household including plot + shared infrastructure/roads/open space) —
TODO, per applicable state resettlement & rehabilitation (R&R) policy.

### 5.2 Water Constraint (`C_water`)

Based on the **55 litres per capita per day (LPCD)** basic service level
benchmark (Ministry of Housing and Urban Affairs / Jal Jeevan Mission
norm for rural):

```
C_water = AvailableWaterSupply_LPD / (55 * AvgHouseholdSize)
```

Where `AvailableWaterSupply_LPD` is the site's assessed sustainable water
source yield in litres/day, and `55` is the fixed LPCD benchmark (do not
treat this as a TODO — it is a stated national norm). `AvgHouseholdSize`
should default to the Census 2011 district average unless a more current
figure is available (see `docs/DATA_SOURCES.md`).

### 5.3 Education Constraint (`C_education`)

Based on **RTE Act, 2009** norms (pupil-teacher ratio and neighbourhood
school-distance norms):

```
C_education = NearbySchoolSpareCapacity / SchoolSeatsPerHousehold
```

**TODO:** `SchoolSeatsPerHousehold` (expected school-age children per
household, from Census/demographic data) and the RTE neighbourhood-norm
distance threshold used to decide which schools count as "nearby" (RTE
Act Schedule: 1 km for classes I–V, 3 km for classes VI–VIII) — confirm
against current state RTE rules and fill in.

### 5.4 Health Constraint (`C_health`)

Based on **Indian Public Health Standards (IPHS)** facility population
norms (e.g. one Sub Health Centre per ~5,000 population in plain areas,
~3,000 in hilly/tribal/difficult areas — confirm current IPHS revision):

```
C_health = NearbyHealthFacilitySpareCapacity / (IPHS_PopulationNorm / AvgHouseholdSize)
```

**TODO:** Confirm the exact IPHS population-per-facility norm to apply
(depends on facility tier — Sub Health Centre / PHC / CHC — and whether
the site is in a plain, hilly, or tribal/difficult area per current IPHS
guidelines) and fill in `IPHS_PopulationNorm`.

### 5.5 Access Constraint (`C_access`)

```
C_access = RoadNetworkCapacity_Households
```

**TODO:** Define how `RoadNetworkCapacity_Households` is derived — e.g.
from all-weather road connectivity requirement, maximum acceptable
distance from a motorable road, or an explicit household cap based on
existing access infrastructure. TODO once the access data source
(Section: OpenStreetMap / state road network data) is finalized in
`docs/DATA_SOURCES.md`.

### 5.6 Reporting

The officer decision workbench always displays, per candidate site:

- `CarryingCapacity` (the minimum, in households)
- `BindingConstraint` (which of land/water/education/health/access
  produced that minimum)
- The individual `C_land`, `C_water`, `C_education`, `C_health`,
  `C_access` values, so the officer can see how close the non-binding
  constraints are to also becoming limiting.
