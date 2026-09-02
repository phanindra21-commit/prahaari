# Seed Data

Synthetic-but-plausible demo data for the two pilot districts, consumed by
`apps/api/src/scripts/seed.ts` (`npm run seed` / `npm run seed:reset` from
the repo root). These files are tracked in git (unlike `data/raw/` and
`data/processed/`) because they are small, deliberately fake, and needed
for anyone to run a working demo of the app.

## Files

| File                               | Contents                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `districts.json`                   | Wayanad (Kerala) and Ganjam (Odisha) — district-level facts   |
| `wayanad-habitations.geojson`      | ~40 habitations across Meppadi, Vythiri, Mananthavady blocks  |
| `ganjam-habitations.geojson`       | ~40 habitations across coastal-to-inland blocks               |
| `wayanad-hazard-zones.geojson`     | Landslide/flood/cloudburst Red-Orange-Yellow-Green zone bands |
| `ganjam-hazard-zones.geojson`      | Coastal-erosion/flood Red-Orange-Yellow-Green zone bands      |
| `hazard-events.json`               | Real historical events (see Provenance below)                 |
| `wayanad-relocation-sites.geojson` | 10 candidate sites, 3 deliberately failing exclusion          |
| `ganjam-relocation-sites.geojson`  | 10 candidate sites, 3 deliberately failing exclusion          |
| `users.json`                       | 5 dev users, one per role, with dev-only passwords            |

## Provenance

Every habitation, hazard zone, and relocation-site record carries
`dataProvenance: "SYNTHETIC_DEMO"` — none of it is real survey data, and it
must never be presented as such. The three hazard events
(`hazard-events.json`) are real and carry `dataProvenance: "PUBLIC_RECORD"`
with a `sourceUrl`:

- **2024 Wayanad landslides (Chooralmala–Mundakkai)**, 30 July 2024.
- **Cyclone Phailin**, 12 October 2013 (landfall near Gopalpur, Odisha).
- **Cyclone Titli**, 11 October 2018.

Casualty/displacement/damage figures for these three events are
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
Chooralmala area for Wayanad landslide risk) or, for Ganjam's
coastal-erosion and flood zones, buffer bands around an approximated
coastline/river line — so exposure visibly decays with distance from the
hazard source, as the brief for this dataset required. Habitation
coordinates are jittered around real block-centre anchors within each
district's actual approximate bounding box; they are illustrative
placements, not surveyed locations.

Relocation-site candidates that are meant to fail hard exclusion criteria
(see `docs/METHODOLOGY.md` Section 4.1) are placed near/inside a Red
hazard-zone band or a coastal buffer and have `exclusionsFailed`
pre-populated directly in the seed data (there is no exclusion-filtering
engine yet — that is Step 9 of the Build Roadmap); sites that pass have a
real `overallSuitabilityScore` and `carryingCapacity` computed against the
actual weights/norms in `packages/shared/src/config/`, not arbitrary
numbers.

## Dev user passwords

`users.json` has a `devPassword` field per user — `seed.ts` hashes it into
`passwordHash` on insert and then prints the plaintext table to the
console so anyone running the seed script can log in locally. These are
**dev-only credentials for a synthetic demo database** and are expected to
be public in this repo; never reuse them for anything real.
