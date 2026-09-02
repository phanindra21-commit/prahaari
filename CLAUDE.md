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
Risk = (Hazard Intensity x Exposure x Vulnerability) / Coping Capacity
```

**Hazards in scope:** landslide, flood, coastal erosion, cloudburst.

**Pilot districts:**

- **Wayanad, Kerala** — primary hazard: landslide
- **Ganjam, Odisha** — primary hazard: cyclone / coastal erosion

Full formulas, thresholds, and index definitions live in
`docs/METHODOLOGY.md`. System design and data flow live in
`docs/ARCHITECTURE.md`. Source datasets are catalogued in
`docs/DATA_SOURCES.md`.

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
├── services/
│   └── ml/               FastAPI service: hazard/vulnerability/suitability models
├── packages/
│   └── shared/           Shared TS types/constants used by web + api
├── data/
│   ├── raw/               Unmodified source datasets (gitignored, see data/README.md)
│   ├── processed/         Derived/cleaned layers (gitignored, regenerate from raw/)
│   └── seed/               Small tracked fixtures for local dev/demo
├── docs/
│   ├── ARCHITECTURE.md
│   ├── METHODOLOGY.md
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

### MongoDB Collection Naming Conventions

- Collection names are **plural, lowerCamelCase**: `habitations`,
  `hazardZones`, `vulnerabilityAssessments`, `relocationSites`,
  `carryingCapacityAssessments`, `officerDecisions`, `auditLogs`, `users`.
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
- [ ] **Step 2 — Data ingestion & schemas:** MongoDB schemas (Mongoose
      models) for habitations, hazard zones, sites; Zod schemas mirroring
      them in `packages/shared`; seed data for Wayanad and Ganjam.
- [ ] **Step 3 — Auth & officer accounts:** JWT auth, role-based access
      (officer/admin/viewer), user model, login flow.
- [ ] **Step 4 — Hazard zoning (ML):** Weighted-overlay + ML susceptibility
      pipeline in `services/ml`, producing Red/Orange/Yellow/Green zone
      polygons per `docs/METHODOLOGY.md`.
- [ ] **Step 5 — Hazard zoning (API + web):** API endpoints to serve zone
      layers; MapLibre rendering of hazard zones on the web map.
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
- [ ] **Step 12 — Audit trail:** Append-only audit log of every officer
      decision, with full before/after state, surfaced in an audit view.
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
