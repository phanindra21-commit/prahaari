# Data Directory

This directory holds geospatial and tabular data used by `services/ml` and
seed data for `apps/api`. See `docs/DATA_SOURCES.md` for the full list of
external datasets, their formats, and licences.

## Layout

- **`raw/`** — Unmodified source data exactly as downloaded from the
  originating agency (Bhuvan, GSI, IMD, CWC, Census, LGD, SRTM, OSM, etc.).
  Never hand-edit files here. Gitignored (datasets are large and/or
  licence-restricted) — download scripts and manifests documenting where
  each file came from are tracked instead.
- **`processed/`** — Cleaned, reprojected, and derived layers produced from
  `raw/` by reproducible scripts in `services/ml`. Gitignored — regenerate
  from `raw/` rather than committing.
- **`seed/`** — Small, tracked fixtures used to seed the local MongoDB
  instance for development and demos (e.g. a handful of habitations for
  Wayanad and Ganjam). These ARE committed to git.

## Provenance

Every file placed under `raw/` must be accompanied by a note (in a
`SOURCE.md` alongside it, or an entry added to `docs/DATA_SOURCES.md`)
recording: where it was downloaded from, the date, the licence, and any
transformation already applied by the source agency.
