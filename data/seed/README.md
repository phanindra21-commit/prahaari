# Seed Data

Synthetic-but-plausible demo data for the three pilot districts, consumed by
`apps/api/src/scripts/seed.ts` (`npm run seed` / `npm run seed:reset` from
the repo root). These files are tracked in git (unlike `data/raw/` and
`data/processed/`) because they are small, deliberately fake, and needed
for anyone to run a working demo of the app.

## Files

| File                               | Contents                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `districts.json`                   | Wayanad (Kerala), Ganjam (Odisha), Chamoli (Uttarakhand) — district-level facts |
| `wayanad-habitations.geojson`      | ~40 habitations across Meppadi, Vythiri, Mananthavady blocks  |
| `ganjam-habitations.geojson`       | ~40 habitations across coastal-to-inland blocks               |
| `chamoli-habitations.geojson`      | 41 habitations across Joshimath, Dasholi, Ghat, Karnaprayag, Pokhri, Gairsain, Narayanbagar, Tharali, Dewal blocks |
| `wayanad-hazard-zones.geojson`     | Landslide/flood/cloudburst Red-Orange-Yellow-Green zone bands |
| `ganjam-hazard-zones.geojson`      | Coastal-erosion/flood Red-Orange-Yellow-Green zone bands      |
| `chamoli-hazard-zones.geojson`     | Landslide/flood/cloudburst Red-Orange-Yellow-Green zone bands (no coastal erosion — landlocked) |
| `hazard-events.json`               | Real historical events (see Provenance below)                 |
| `wayanad-relocation-sites.geojson` | 10 candidate sites, 3 deliberately failing exclusion          |
| `ganjam-relocation-sites.geojson`  | 10 candidate sites, 3 deliberately failing exclusion          |
| `chamoli-relocation-sites.geojson` | 11 candidate sites, 3 deliberately failing exclusion (2 protected forest, 1 excessive slope) |
| `users.json`                       | 8 dev users covering all 5 roles (3x DISTRICT_OFFICER, 2x STATE_ADMIN) |

## Provenance

Every habitation, hazard zone, and relocation-site record carries
`dataProvenance: "SYNTHETIC_DEMO"` — none of it is real survey data, and it
must never be presented as such. The six hazard events (`hazard-events.json`)
are real and carry `dataProvenance: "PUBLIC_RECORD"` with a `sourceUrl`:

- **2024 Wayanad landslides (Chooralmala–Mundakkai)**, 30 July 2024.
- **Cyclone Phailin**, 12 October 2013 (landfall near Gopalpur, Odisha).
- **Cyclone Titli**, 11 October 2018.
- **2021 Rishiganga–Raini rock-ice avalanche and flash flood**, 7 February
  2021 (destroyed the Tapovan-Vishnugad hydro project; tagged `landslide`
  as the nearest available `hazardType`, since this platform's four hazard
  types do not include rock-ice avalanche — see the METHODOLOGY glacial-
  hazard limitation).
- **2013 Uttarakhand floods**, as they affected Chamoli's Alaknanda valley
  (17 June 2013 onward).
- **2023 Joshimath land subsidence**, first widely reported 2 January 2023.
  Recorded even though ground subsidence is not one of this platform's
  four hazard types (tagged `landslide` as the nearest available value) —
  see the same METHODOLOGY limitation note; Joshimath is this dataset's
  anchor habitation for Chamoli, the way Chooralmala/Mundakkai is for
  Wayanad.

Casualty/displacement/damage figures for these six events are
commonly-reported approximate figures (sources vary), included for demo
realism, not asserted as precise or authoritative.

**`lgdCode` values in `districts.json` are DEMO PLACEHOLDERS** (prefixed
`DEMO-`), not verified codes from
[lgdirectory.gov.in](https://lgdirectory.gov.in) — replace them with real
LGD codes before any non-demo use. All habitation/site `districtLgdCode` /
`lgdHabitationCode` fields in the other files reference these same
placeholder codes purely as an internal seed join key.

## How the geometry was generated

Hazard-zone polygons are concentric buffer bands (Red innermost, Green
outermost) around a hazard-plausible anchor point (e.g. the Meppadi/
Chooralmala area for Wayanad landslide risk, or the Joshimath–Raini
corridor for Chamoli landslide risk) or, for Ganjam's coastal-erosion and
flood zones, buffer bands around an approximated coastline/river line — so
exposure visibly decays with distance from the hazard source, as the brief
for this dataset required. These seeded bands are a demo baseline only —
running the zoning pipeline for a district (`POST /api/v1/pipeline/run` or
`/zoning/run`) computes and persists the district's real, grid-cell-derived
`HazardZone` documents, which are what the map and every downstream score
actually use once a pipeline run has completed. Habitation coordinates are
jittered around real block-centre anchors within each district's actual
approximate bounding box; they are illustrative placements, not surveyed
locations.

**District boundaries** (`districts.json`) are real GADM v2.8
administrative district polygons (see `docs/DATA_SOURCES.md`'s GADM row),
not hand-drawn — this was not always true: an earlier version of Wayanad's
boundary was a hand-drawn simple bounding rectangle that started at
11.55°N and excluded the district's own southern tip — Meppadi taluk,
where Chooralmala and Mundakkai (real coordinates, ~11.51°N/11.52°N)
actually sit — silently dropping 16 of Wayanad's 40 habitations from the
H3 grid and every downstream hazard/vulnerability score. Wayanad and
Ganjam were replaced with real GADM boundaries in Step 10 Part 2; Chamoli
was seeded with its real GADM boundary from the start. `apps/api/src/
scripts/validateSeedGeometry.ts` (run automatically by `npm run seed`)
fails the seed run loudly if any habitation ever falls outside its
district's real boundary polygon, rather than letting that kind of
mismatch resurface silently — one Chamoli habitation (Maikoti, Gairsain
block) needed its anchor moved ~2.2 km north for exactly this reason when
first seeded, per this file's own standing rule to move the habitation,
never distort the boundary.

Relocation-site candidates that are meant to fail hard exclusion criteria
(see `docs/METHODOLOGY.md` Section 4.1) are placed with `rawAttributes`
values that a real candidate site would not have — e.g. `slopeDegrees`
above the 20° cutoff, or `inProtectedForest: true` for Chamoli's two
forest-buffer failures (Nanda Devi National Park and the Valley of
Flowers National Park, both UNESCO World Heritage Sites within Chamoli
district) — and are excluded live by `services/ml/app/engine/
exclusions.py` when the site-scoring pipeline stage runs (Step 9 of the
Build Roadmap), not pre-populated in the seed data itself: every seeded
site starts with `exclusionsPassed`/`exclusionsFailed` empty and
`overallSuitabilityScore`/`carryingCapacity` null, the same as a freshly
seeded `GridCell` before a zoning run. Sites that pass exclusion get a
real `overallSuitabilityScore` and `carryingCapacity` computed against the
actual weights/norms in `packages/shared/src/config/` once the pipeline
runs, not arbitrary numbers.

## Users

`users.json` holds 8 users: one SUPER_ADMIN; one ANALYST and one
FIELD_VOLUNTEER (scoped to Wayanad and Ganjam district respectively, as
before Chamoli was added); **three** DISTRICT_OFFICER accounts — one per
pilot district (Wayanad, Ganjam, Chamoli) — since `recommendation:approve`
is a DISTRICT_OFFICER-only permission (`docs/SECURITY.md` Section 4) and
every pilot district needs an approver for the demo; and **two**
STATE_ADMIN accounts (Kerala, Uttarakhand) — Odisha has no seeded
STATE_ADMIN, same as before Chamoli was added, since Ganjam's own
DISTRICT_OFFICER and FIELD_VOLUNTEER already exercise that role's scope
paths. Uttarakhand's STATE_ADMIN exists specifically to exercise the
multi-district-per-state scope path Kerala/Odisha's single-district states
cannot (see `docs/SECURITY.md`'s scope regression tests) — though as of
Chamoli's addition Uttarakhand, like Kerala and Odisha, still has only one
seeded district, so this remains a single-district scope test until a
second Uttarakhand district is ever added.

No `users.json` entry carries a password. `seed.ts` resolves each user's
password from environment variables: `SEED_DEFAULT_PASSWORD`
(`apps/api/.env.example`, documented dev default
`PunarVas@DevDefault123`) unless a per-role override
`SEED_PASSWORD_<ROLE>` is set (e.g. `SEED_PASSWORD_SUPER_ADMIN`). The
resolved passwords are hashed with bcrypt (cost 12) before being stored,
and the plaintext values are printed as a table at the end of the seed
run so anyone running it can log in locally. These are **dev-only
credentials for a synthetic demo database**; never reuse them for
anything real.
