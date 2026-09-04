# CLAUDE.md

Persistent context for AI assistants (and humans) working on this repository.
Read this file in full before making changes.

## Project Purpose

**PunarVas** ("पुनर्वास" — resettlement/rehabilitation) is a Human-in-the-Loop
AI + GIS decision-support platform built for Smart India Hackathon. It helps
Indian state disaster-management authorities move from _reactive_ disaster
response to _proactive_ hazard zoning and planned relocation of vulnerable
habitations — while keeping a human officer as the final, accountable
decision-maker at every step.

The system never auto-executes a relocation decision. It produces
ranked, explainable recommendations; an authorized officer reviews, and
either approves or overrides each one with a mandatory written justification.
Every action is written to an immutable audit trail.

## Domain Summary

**Pipeline:**

```
identify multi-hazard Red Zones
        -> assess habitation vulnerability
        -> compute a Relocation Priority Index (RPI)
        -> find candidate relocation sites
        -> compute carrying capacity of sites
        -> officer approves / overrides every recommendation
           (mandatory justification + full audit trail)
```

**Core risk model:**

```
Risk = (Hazard Intensity x Exposure x VulnerabilityIndex) / (1 + CopingCapacity)
```

(`CopingCapacity` is a 0–1 index added to 1 in the denominator so the
formula never divides by zero and Risk is never negative — see
`docs/METHODOLOGY.md` Section 0/2.2.)

**Hazards in scope:** landslide, flood, coastal erosion, cloudburst.

**Pilot districts:**

- **Wayanad, Kerala** — primary hazard: landslide
- **Ganjam, Odisha** — primary hazard: cyclone / coastal erosion

Full formulas, thresholds, and index definitions live in
`docs/METHODOLOGY.md`. System design and data flow live in
`docs/ARCHITECTURE.md`. Source datasets are catalogued in
`docs/DATA_SOURCES.md`. Auth, RBAC, and the audit trail are covered in
`docs/SECURITY.md`.

## Tech Stack

| Layer             | Stack                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| `apps/web`        | React 18 + Vite + TypeScript + Tailwind CSS + MapLibre GL JS + Zustand + TanStack Query |
| `apps/api`        | Node 20 + Express + TypeScript + Mongoose (MongoDB) + Zod + JWT                         |
| `services/ml`     | Python 3.11 + FastAPI + scikit-learn + XGBoost + SHAP + geopandas + rasterio            |
| `packages/shared` | Shared TypeScript types and constants, consumed by `apps/web` and `apps/api`            |
| Monorepo tooling  | npm workspaces, ESLint + Prettier, concurrently                                         |

## Folder Layout

```
SIH/
├── apps/
│   ├── web/            React + Vite frontend (map UI, officer workbench)
│   └── api/             Express API (auth, CRUD, orchestrates services/ml)
│       └── src/models/    Mongoose models (16 collections, see below)
│       └── src/lib/        JWT, password hashing, sessions, audit(), RBAC helpers,
│                            mlServiceClient (timeout+retry+Zod), zoneVersioning
│       └── src/lib/jobs/   In-process job runner (zoningJob.ts — no queue)
│       └── src/middleware/ authenticate, requirePermission, requireScope, rate limits
│       └── src/routes/     /api/v1/auth/**, /api/v1/audit/**, /api/v1/zoning/**,
│                            /api/v1/zones**, /api/v1/grid**
│       └── src/scripts/   seed.ts, generateGrid.ts, ingestFactors.ts + Zod schemas
├── services/
│   └── ml/               FastAPI service: hazard/vulnerability/suitability models
│       └── app/engine/     reclassify, overlay, labels, train, blend, zones, explain,
│                            pipeline (the request-driven scoring core)
│       └── app/routes/     /zoning/run
│       └── scripts/        derive_factors.py, run_scoring_pipeline.py,
│                            run_zoning_pipeline.py (offline dev/demo runners)
├── packages/
│   └── shared/           Shared TS types/constants used by web + api
│       └── src/config/     Single-source-of-truth weight/norm/permission JSON + loader
│       └── src/schemas/    Zod schemas mirroring every Mongoose model
├── data/
│   ├── raw/               Unmodified source datasets (gitignored, see data/README.md)
│   ├── processed/         Derived/cleaned layers (gitignored, regenerate from raw/)
│   └── seed/               Small tracked fixtures for local dev/demo
├── docs/
│   ├── ARCHITECTURE.md
│   ├── METHODOLOGY.md
│   ├── ZONING_PIPELINE.md
│   ├── SECURITY.md
│   └── DATA_SOURCES.md
├── CLAUDE.md              (this file)
├── README.md
└── package.json            npm workspaces root
```

## Coding Conventions

- **TypeScript strict mode everywhere.** `strict: true` is set in every
  `tsconfig.json` in this repo (`apps/web`, `apps/api`, `packages/shared`).
  Do not weaken it.
- **No `any`.** `@typescript-eslint/no-explicit-any` is an ESLint error, not
  a warning. Use `unknown` + narrowing, generics, or a precise type instead.
- **Named exports only.** No default exports for components, functions, or
  modules, except where a framework requires it (e.g. Vite's `App` root
  component may keep a default export alongside its named one; API route
  handlers are named).
- **Zod validation at every API boundary.** Every `apps/api` route validates
  `req.body` / `req.params` / `req.query` with a Zod schema before touching
  application logic. Every FastAPI endpoint in `services/ml` validates
  input with a Pydantic model (the Python-side equivalent of this rule).
  Never trust data crossing a process boundary (web -> api, api -> ml,
  api -> MongoDB) without validating it at the boundary.
- **Shared types live in `packages/shared`.** If a type is used by both
  `apps/web` and `apps/api`, it belongs in `packages/shared`, not duplicated.
- **Officer actions are never silent.** Any endpoint that approves,
  overrides, or otherwise changes a recommendation must require a
  justification field and write an audit record. This is a product
  requirement, not just a coding style note — see `docs/METHODOLOGY.md` and
  the human-in-the-loop principle in `docs/ARCHITECTURE.md`.

### Auth Conventions

Full design in `docs/SECURITY.md` — this is the enforceable rule:

- **Every state-changing route (`apps/api`) must be wrapped in
  `requirePermission('resource:action')` AND `requireScope()`, in that
  order, after `authenticate`.** `requirePermission` answers "can this
  role ever do this"; `requireScope()` answers "which specific rows" by
  attaching a Mongo filter fragment to `req.scopeFilter` that must be
  merged into the query _before_ it runs — never as a post-hoc check on
  already-fetched documents. Neither middleware alone is sufficient: a
  route with only `requirePermission` lets any `DISTRICT_OFFICER` touch
  any district's data; a route with only `requireScope` lets any
  authenticated role (including `FIELD_VOLUNTEER`) attempt writes it has
  no business making.
- The RBAC matrix is data, not code: `packages/shared/src/config/permissions.json`,
  same single-source-of-truth pattern as the weight configs. Add a new
  permission there (and to the role grant lists) before wiring a route to
  it — never hardcode a role check inline in a route handler.
- Passwords: bcrypt cost 12 (`apps/api/src/lib/password.ts`). Never
  return `passwordHash` from a query (`select: false` on the schema
  field) — always go through `User.toSafeJSON()`.
- Every officer/system action that changes state gets an audit entry via
  `apps/api/src/lib/audit.ts`'s `audit()` — never write to `AuditLog`
  any other way (the model actively rejects every mutation path except a
  plain insert).

### MongoDB Collection Naming Conventions

- Collection names are **plural, lowerCamelCase**: `users`, `districts`,
  `habitations`, `hazardZones`, `hazardEvents`, `assessments`,
  `relocationSites`, `recommendations`, `decisions`, `auditLogs`,
  `scenarioRuns`, `refreshTokens`, `fieldReports`, `gridCells`,
  `modelRuns`, `jobs` — the full list of 16 collections, each with a
  Mongoose model in `apps/api/src/models/` and a matching Zod schema in
  `packages/shared/src/schemas/`.
- Every document has `createdAt` / `updatedAt` (Mongoose timestamps).
- Every document that represents an officer-reviewable recommendation
  carries a `status` field with an explicit enum (e.g.
  `"pending" | "approved" | "overridden" | "rejected"`) — never a bare
  boolean flag for approval state.
- Foreign references use the referenced collection's singular name + `Id`
  (e.g. `habitationId`, `relocationSiteId`), typed as Mongoose `ObjectId`.
- Audit records (`auditLogs`) are append-only: no update or delete
  operations are ever issued against this collection from application code.

## Build Roadmap

Status of the full multi-step build. Update the checkbox when a step is
completed.

- [x] **Step 1 — Scaffold:** Monorepo structure, npm workspaces, hello-world
      apps (web/api/ml), shared package, docs (this file, ARCHITECTURE,
      METHODOLOGY, DATA_SOURCES), lint/format tooling, git init.
- [x] **Step 2 — Data ingestion & schemas:** 11 Mongoose models
      (`apps/api/src/models/`) with matching Zod schemas in
      `packages/shared/src/schemas/`; single-source-of-truth weight/norm
      config in `packages/shared/src/config/` (loaded and validated by
      both the Node and Python sides); idempotent seed script
      (`npm run seed` / `seed:reset`) loading ~130 synthetic-but-plausible
      documents for Wayanad and Ganjam from `data/seed/`.
- [x] **Step 3 — Auth, RBAC, audit trail:** JWT access (15m) + rotating
      refresh tokens (7d, hashed, reuse detection revokes the whole
      family) via `/api/v1/auth/**`; bcrypt cost-12 passwords, account
      lockout, IP+email rate limiting; RBAC permission matrix
      (`packages/shared/src/config/permissions.json`) enforced by
      `requirePermission` + `requireScope` (row-level, pre-query
      filtering); hash-chained, append-only, tamper-evident `AuditLog`
      with `/api/v1/audit/**`. See `docs/SECURITY.md`.
- [x] **Step 4 — Hazard zoning (ML + API):** H3 resolution-8 grid
      (`GridCell`) filled per district; SYNTHETIC_DEMO but
      spatially-coherent causative factors (`derive_factors.py`);
      weighted-overlay + XGBoost ML susceptibility engine
      (`services/ml/app/engine/`) trained on noised synthetic labels
      (spatial block split, never random) and blended (`alpha=0.6`);
      zone classification + dissolve + versioning (`HazardZone`, never
      mutated); SHAP top-factor explanations; live `/api/v1/zoning/run`
      job + `/api/v1/zones**` + `/api/v1/grid**` endpoints behind
      `requirePermission`+`requireScope`, audited on start and finish.
      See `docs/ZONING_PIPELINE.md`.
- [x] **Step 5 — Hazard zoning (web):** MapLibre rendering of hazard zones
      on the web map, consuming Step 4's `/api/v1/zones` and `/api/v1/grid`.
      Done as part of Step 6's web-app build below (`apps/web/src/
      components/map/`) — the map consumes `/api/v1/zones` (dissolved
      polygons) rather than raw `/api/v1/grid` cells; see Step 6's status
      block for why.

  **Note:** a separate, later work session also used the name "Step 5" for
  a different scope (fixing Step 4 issues, then vulnerability/coping-
  capacity/RPI — roadmap Steps 6+8 below — then API/docs). That work is
  tracked in its own status block immediately below rather than renumbered
  in place, to avoid rewriting history — don't confuse the two "Step 5"s.

  ### Step 5 (fix Step 4 + vulnerability/RPI) — DONE

  **Commit 1** (`88d58c0` "fix: orphaned habitations, weak ML signal,
  per-hazard blend"): Wayanad/Ganjam district boundaries corrected
  (Chooralmala/Mundakkai now have grid coverage — landslide blendedScore
  0.744/0.777, both Red), `validateSeedGeometry.ts` guards against a
  regression, ML labels redesigned to a physically-motivated latent
  process landing all four hazards' AUC-ROC in 0.72-0.85 (was 0.50-0.64),
  `blend-config.json`'s alpha is now per-hazard.

  **Commit 2** (`0f578fc` "feat: assessment pipeline, RPI-ceiling fix, and
  full pipeline job"): the vulnerability/coping-capacity/risk/RPI engine
  (`services/ml/app/engine/{vulnerability,risk,priority,assessment}.py`),
  `Habitation.copingCapacity`, `Assessment` versioning, wired end-to-end
  behind `POST /api/v1/pipeline/run` (grid → zones → assessments,
  per-stage progress via `apps/api/src/lib/jobs/pipelineJob.ts` +
  `assessmentStage.ts`).

  Fixed the RPI-ceiling bug flagged below: `Risk = H*E*VI/(1+CopingCapacity)`
  is multiplicative in VI, so `Risk <= VI` always; treating §3's
  `normalize(Risk)` as a no-op made `RPI <= VI` for every habitation
  (verified: 0 of 27 Red/Orange habitations reached Immediate/ShortTerm
  pre-fix). Fix: `normalize(Risk)` is population-relative min-max
  rescaling of a habitation's governing Risk against the other Red/Orange
  habitations in the same district-scoped run
  (`priority.py::normalize_risk`) — see `docs/METHODOLOGY.md` §3's
  implementation note and `docs/SCORING_PIPELINE.md`'s worked example.
  Verified against live Wayanad/Ganjam data post-fix: 3 of 27 Red/Orange
  habitations now reach Immediate (Pozhuthana, Kottathara, Sorada),
  distribution 3 Immediate / 14 ShortTerm / 10 MediumTerm.

  **Honest residual finding, not a bug:** Chooralmala and Mundakkai — the
  actual 2024 landslide site — still land in MediumTerm/ShortTerm
  (RPI 0.446/0.482) even after the structural fix, not Immediate.
  Diagnosed: within Wayanad's batch, cloudburst's synthetic Red-zone
  hazard scores run higher than landslide's in this dataset (each
  hazard's label calibration was tuned independently in Commit 1 to its
  own AUC target, with no cross-hazard magnitude-consistency constraint),
  and the cloudburst-governed habitations that outrank them also carry
  higher VI. This was diagnosed and reported, not tuned away, per this
  project's standing instruction not to force a particular answer.

  **Commit 3** (routes + docs): `GET /api/v1/habitations` (paginated,
  filterable by district/bucket/zoneClass, GeoJSON option),
  `GET /api/v1/habitations/:id`, `GET /api/v1/habitations/:id/assessment`
  (with `?at=` history), `GET /api/v1/habitations/:id/explain`,
  `GET /api/v1/priorities` — all behind `requirePermission`+`requireScope`,
  every response Zod-validated (`apps/api/src/routes/habitation.routes.ts`).
  `docs/SCORING_PIPELINE.md` added: full pipeline diagram plus a worked,
  reproducible numeric example (Chooralmala) traced from raw attributes
  through every intermediate value to the final RPI/bucket.

  All of the above is tested and passing (96 Python + 202 TS tests,
  typecheck/lint clean).

  **Not done in this track (left for later steps):** the web UI — a
  MapLibre habitation/priority-list view consuming these new endpoints —
  is Step 7/8/11's remaining web half, not built here.

  **Note:** the vulnerability/RPI ML+API work this block describes
  already covers roadmap Steps 6 and 8's ML/API halves; their remaining
  web halves (Steps 7/8) were built in the Step 6 track below (same
  reused-name situation as Step 5 above — see that note).

  ### Step 6 (calibration + web app) — DONE

  A later work session used the name "Step 6" for its own scope:
  calibrating the hazard model against the real 2024 Wayanad landslide
  as ground truth, then building `apps/web` out from its Step 1
  placeholder into a working map-first officer workbench.

  **Commit 1** (`5331c13`): diagnosed and fixed three miscalibrations in
  cloudburst's synthetic factor generation that let it govern Wayanad
  habitations (including Chooralmala/Mundakkai) ahead of landslide;
  wired disaster history into scoring for the first time
  (`services/ml/app/engine/disaster_history.py`,
  `packages/shared/src/config/disaster-history.json`); corrected
  unrealistic seed data for Chooralmala/Mundakkai; fixed a live/offline
  divergence in flood zoning (now bit-identical). Mundakkai now reaches
  Immediate priority; Chooralmala rises to ShortTerm; both remain
  cloudburst-governed for an honestly-diagnosed residual reason. Full
  before/after numbers in `docs/METHODOLOGY.md`'s new Validation Against
  Ground Truth section.

  **Commit 2** (`d1d71de` + `a61b2ff`): while wiring the web app's
  district switcher, found and fixed a critical pre-existing bug —
  `requireScope()` passed the wrong shape to `buildScopeFilter()`, so
  every non-SUPER_ADMIN role's scope filter silently matched nothing
  (not "only their own district" — nothing at all) since Step 3; masked
  because every existing scope test only asserted the negative case.
  Added positive-case regression tests. Also added
  `GET /api/v1/districts`, `/api/v1/hazard-events`,
  `/api/v1/relocation-sites` (small, read-only, needed by the map).

  **Commit 3** (`a61b2ff`): `apps/web` — React Router, a Zustand auth
  store matching Step 3's refresh-rotation scheme, a login page, a
  role-aware protected layout, a MapLibre map (dissolved hazard zones,
  habitation points sized/colored by population/priority, relocation
  site markers, per-hazard layer toggles, a legend, a real elevation
  hillshade basemap — no API key), a habitation detail panel (risk
  breakdown, VI dimension bars, plain-language top factors, a disaster-
  history timeline, a provenance/advisory-only footer on every panel),
  and a priorities worklist page. This is Step 5's MapLibre web view and
  Step 7/8's remaining web halves, all done here rather than in those
  slots, for the same reused-name reason as above.

  **Not verified:** no browser automation was available in that session
  — typecheck/lint/build/every-endpoint-hit-directly were all verified,
  actual browser rendering was not. Flagged, not glossed over.
- [x] **Step 6 — Vulnerability assessment (ML):** Vulnerability index model
      (demographic, socio-economic, structural, accessibility, coping
      capacity components). Done in the Step 5 (fix Step 4 + vulnerability/
      RPI) track above.
- [x] **Step 7 — Vulnerability assessment (API + web):** Endpoints + UI to
      surface per-habitation vulnerability scores and component breakdown.
      API in the Step 5 track above; web (VI dimension bars) in the
      Step 6 (calibration + web app) track above.
- [x] **Step 8 — Relocation Priority Index:** RPI computation combining
      risk + vulnerability, bucketed into Immediate/Short-term/Medium-term,
      exposed via API and a prioritized list view in web. API in the
      Step 5 track above; the web priority list is the Step 6 (calibration
      + web app) track's Priorities page.
- [x] **Step 9 — Candidate site discovery:** Exclusion-criteria filtering +
      AHP-weighted site suitability scoring in `services/ml`. Done in the
      Step 7 (relocation sites + decision workbench) track below.
- [x] **Step 10 — Carrying capacity:** Land/water/education/health/access
      constraint model, reporting the binding constraint per candidate site.
      Done in the Step 7 track below (same commit as Step 9).
- [x] **Step 11 — Officer decision workbench:** Web UI where an officer
      reviews a recommendation (hazard, vulnerability, RPI, candidate
      sites, capacity) and approves/overrides with mandatory justification.
      Done in the Step 7 track below.
- [ ] **Step 12 — Audit trail UI:** The append-only, hash-chained
      `AuditLog` backend and `/api/v1/audit/**` API already exist (Step 3).
      **Partially done** in the Step 7 track below: `Decision`-specific
      before/after snapshots are wired (every decision's overridden fields
      are diffed and shown), and a recommendation-scoped audit view with a
      chain-verification indicator exists
      (`GET /recommendations/:id/audit-trail`, `AuditTrailPanel.tsx`). What
      remains: a general, district-wide filterable audit-log table backed
      by the broader `GET /api/v1/audit` endpoint — deliberately not built
      in the Step 7 track (see that track's note on why granting
      `DISTRICT_OFFICER` the `auditLog:read` permission was rejected as a
      scope leak).
- [ ] **Step 13 — Explainability:** SHAP-based explanations surfaced
      alongside every ML-driven score shown to the officer. Hazard/
      vulnerability scores already surface SHAP-derived explanations
      (Step 4/6 tracks); site suitability (AHP, not a black-box model) is
      shown as a transparent per-criterion weighted breakdown instead
      (Step 7 track below) — nothing further planned here without a new
      ML-driven score that needs it.
- [ ] **Step 14 — Deployment & demo hardening:** Production build/deploy
      config, seeded demo dataset for Wayanad + Ganjam, walkthrough script
      for the hackathon presentation.

  ### Step 7 (relocation sites + decision workbench) — DONE

  A later work session used "Step 7" for its own three-commit scope,
  unrelated to this roadmap's own numbering (same reused-name situation as
  Steps 5/6 above — the two numbering schemes are tracked separately, not
  reconciled in place).

  **Commit 1** (`a262f42`): compound-hazard handling (a (trigger,
  mechanism) pair, e.g. cloudburst triggering landslide, both
  independently Red/Orange, reported as one compound risk rather than two
  competing hazards) + UI self-check fixes.

  **Commit 2** (`d254bda`): METHODOLOGY §4/§5 — `services/ml/app/engine/
  {exclusions,suitability,capacity,site_matching}.py`, `POST /sites/run`,
  `siteStage.ts` (a third pipeline stage scoring every `RelocationSite` in
  a district and matching Immediate/ShortTerm habitations to ranked
  candidate sites, priority-ordered with cumulative capacity tracking),
  `GET /sites`, `/sites/:id`, `/recommendations`, `/recommendations/:id`.
  Found and fixed a real dimensional-analysis bug in the documented
  `C_health` carrying-capacity formula (dividing by a households-per-
  facility figure instead of a per-household rate — made every seeded
  site's health capacity ~0.3 households, silently making the whole
  matching pipeline vacuous); see `docs/METHODOLOGY.md` §5.4's corrected
  formula and explanatory note. 150 new Python tests, full TS suite green.

  **Commit 3** (`0b8dd42` backend, `36298e5` frontend): the officer
  decision workbench. `POST /api/v1/decisions` (Approve/Modify/Reject/
  Defer, mandatory >=30-char justification, whitelisted field overrides
  with from/to stale-value checking), `GET /recommendations/:id/audit-
  trail` (a recommendation-scoped alternative to granting
  `DISTRICT_OFFICER` the broad `auditLog:read` permission, which would
  leak every other district's audit data since `AuditLog` has no
  per-district filter — considered and explicitly reverted, see
  `docs/SECURITY.md`). Found and fixed a real bug while testing: hash-
  chained audit writes blew the call stack on live Mongoose documents in
  a `before`/`after` payload (`Recommendation.phasing`), silently
  dropping the AuditLog entry for every decision — fixed centrally in
  `hashChain.ts::canonicalize()` for every caller, not just this route.

  Web: a review queue (`/recommendations`, filterable by bucket/status)
  leading with a district capacity-shortfall banner — computed from
  already-scoped `GET /priorities` + `GET /recommendations` data, no new
  endpoint — stating e.g. live Wayanad data: "lacks sufficient safe
  land... 4 of 7 [Immediate/Short-term habitations] do not [have a viable
  site]"; a recommendation detail view (`/recommendations/:id`) with a
  focused origin/destination MapLibre view, per-criterion AHP suitability
  bars, and carrying capacity with the binding constraint named
  prominently; the decision action panel (RBAC-gated on
  `recommendation:approve` — every other role sees an explicit read-only
  "Approval restricted" note); a "chain verified" badge; and a map
  decision-ring overlay (color per decision status) once a habitation has
  one, with a new `ZoneLegend` section explaining it.

  Verified in a real browser (Playwright against the built production
  bundle, not just the dev server — this repo's standing rule after an
  earlier session's blank-#root regression passed every static check) —
  full stack (mongo + api + services/ml, freshly seeded, grid generated,
  factors derived/ingested, pipeline run for Wayanad): login as the
  seeded Wayanad `DISTRICT_OFFICER`, the capacity banner rendering real
  data (7 eligible, 3 matched, 4 not), opening a recommendation, the map
  and suitability/capacity panels rendering, submitting an Approve
  decision with a justification, and the chain-verified badge appearing —
  kept as `apps/web/e2e/decision-workbench.spec.ts` (same
  `PUNARVAS_E2E_BACKEND=1`-gated pattern as the existing smoke test).
  Also manually verified and then discarded (not kept as standing tests):
  an `ANALYST` sees the read-only restricted note instead of decision
  controls; a `DISTRICT_OFFICER`'s district switcher never lists another
  district; the map legend's decision-ring section appears once a
  decision exists.

  **Known pre-existing issue, not introduced here:** the CARTO free-tier
  basemap tiles now render an "API KEY REQUIRED" watermark in every map
  view (main map and the new recommendation-detail map) — a change on
  CARTO's side since `mapStyle.ts` was written in the Step 6 track, not a
  regression from this track. Not fixed here (out of scope for Step 7);
  flagged for whoever picks up Step 14 (deployment hardening).

  ### Step 8 (basemap fix + scenario simulator) — DONE

  Not one of this roadmap's original 14 steps — a later session's own
  two-part scope, using "Step 8" as its own name (same reused-numbering
  situation as Steps 5/6/7 above).

  **Part 1** (`6ec51fd`): fixed the CARTO "API KEY REQUIRED" watermark
  flagged as a known issue in the Step 7 track above — CARTO's free
  basemap tiles started requiring a key. Replaced with Esri's classic
  public basemap REST services (`server.arcgisonline.com`, keyless for
  over a decade): `Elevation/World_Hillshade_Dark` as the base layer
  itself (real elevation relief baked in, not a flat color needing a
  separate hillshade composited over it) plus `Canvas/World_Dark_Gray_Reference`
  for labels/boundaries on top. Verified by direct tile fetch and then in
  a real browser (screenshots, zero "API KEY REQUIRED" text in the DOM).

  **Part 2** (`0872dfd` backend, `99f29ce` frontend): the scenario
  simulator — `services/ml/app/engine/scenario.py` perturbs a hazard's
  causative factors per a documented parameter mapping
  (`packages/shared/src/config/scenario-parameters.json`: rainfall,
  sea-level rise, cyclone category, every preset citing a real source —
  the 2024 Wayanad event, Cyclone Phailin, IPCC AR5 RCP8.5) and re-runs
  overlay → ML → blend → classify, training the XGBoost model exactly
  ONCE per (district, hazard) and reusing it for the perturbed pass (the
  key performance lever). Computes the delta against a same-call
  baseline — cell class-transition counts, newly-Red cells, habitations
  changing priority bucket, any habitation newly entering Immediate —
  and persists it onto a new `ScenarioRun` document only; the district's
  active zoning/assessment is never touched. `POST/GET/DELETE /api/v1/scenarios**`,
  audited via the existing `autoAudit` middleware, `scenario:run`/`scenario:read`
  already in the RBAC matrix.

  Measured true runtime against full real district data (not synthetic
  benchmarks): Wayanad (2793 cells × 3 hazards) 3.9-5.3s; Ganjam (8242
  cells, the larger district) 4.8-8.7s depending on how many hazards the
  parameters affect — all comfortably under the 10s target.

  Found and fixed a real bug during live-stack verification, not caught
  by mocked route tests: `explain.py`'s SHAP explainer cache keyed on
  `id(trained.model)` (a memory address) — training several models
  back-to-back in one process (exactly what a multi-hazard scenario run
  does) let a garbage-collected model's freed address get reused by a
  new, differently-shaped model, silently handing back the WRONG
  explainer and crashing deep inside `shap_values()` with an opaque
  XGBoost shape assertion. Reproduced against live Wayanad data, fixed at
  the root (the cache now keys on the model object itself via a
  `WeakKeyDictionary`, structurally immune to the collision and no longer
  leaking indefinitely either), re-verified live afterward.

  Frontend: a scenario panel on the map (sliders, presets with citation
  tooltips, saved/reloadable runs), a scenario zone overlay that replaces
  the live hazard layers while active (never both at once) with a dashed
  "what changed" highlight, a baseline/scenario toggle, a delta summary
  panel, and a persistent "hypothetical, not official" banner. Verified
  in a real browser (Playwright, built production bundle) against the
  live stack — kept as `apps/web/e2e/scenario-simulator.spec.ts` (same
  `PUNARVAS_E2E_BACKEND=1`-gated pattern as the other standing e2e specs).

## Why Python Is a Separate Service

See `docs/ARCHITECTURE.md` for the full rationale — in short: geospatial
(`geopandas`, `rasterio`) and ML (`scikit-learn`, `XGBoost`, `SHAP`) tooling
is Python-native and not realistically portable to Node without losing
ecosystem support, so `services/ml` is a separate FastAPI process that
`apps/api` calls over HTTP rather than a library imported into Node.
