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
- [ ] **Step 5 — Hazard zoning (web):** MapLibre rendering of hazard zones
      on the web map, consuming Step 4's `/api/v1/zones` and `/api/v1/grid`.
- [ ] **Step 6 — Vulnerability assessment (ML):** Vulnerability index model
      (demographic, socio-economic, structural, accessibility, coping
      capacity components).
- [ ] **Step 7 — Vulnerability assessment (API + web):** Endpoints + UI to
      surface per-habitation vulnerability scores and component breakdown.
- [ ] **Step 8 — Relocation Priority Index:** RPI computation combining
      risk + vulnerability, bucketed into Immediate/Short-term/Medium-term,
      exposed via API and a prioritized list view in web.
- [ ] **Step 9 — Candidate site discovery:** Exclusion-criteria filtering +
      AHP-weighted site suitability scoring in `services/ml`.
- [ ] **Step 10 — Carrying capacity:** Land/water/education/health/access
      constraint model, reporting the binding constraint per candidate site.
- [ ] **Step 11 — Officer decision workbench:** Web UI where an officer
      reviews a recommendation (hazard, vulnerability, RPI, candidate
      sites, capacity) and approves/overrides with mandatory justification.
- [ ] **Step 12 — Audit trail UI:** The append-only, hash-chained
      `AuditLog` backend and `/api/v1/audit/**` API already exist (Step 3)
      — this step is the officer-facing audit view (filterable table,
      chain-verification indicator) in `apps/web`, plus wiring
      `Decision`-specific before/after snapshots once Step 11 exists.
- [ ] **Step 13 — Explainability:** SHAP-based explanations surfaced
      alongside every ML-driven score shown to the officer.
- [ ] **Step 14 — Deployment & demo hardening:** Production build/deploy
      config, seeded demo dataset for Wayanad + Ganjam, walkthrough script
      for the hackathon presentation.

## Why Python Is a Separate Service

See `docs/ARCHITECTURE.md` for the full rationale — in short: geospatial
(`geopandas`, `rasterio`) and ML (`scikit-learn`, `XGBoost`, `SHAP`) tooling
is Python-native and not realistically portable to Node without losing
ecosystem support, so `services/ml` is a separate FastAPI process that
`apps/api` calls over HTTP rather than a library imported into Node.
