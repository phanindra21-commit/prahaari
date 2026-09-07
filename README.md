# PRAHARI — प्रहरी, "sentinel"

Human-in-the-Loop AI + GIS decision-support platform for proactive hazard
zoning and relocation of vulnerable habitations in India. Built for Smart
India Hackathon. Pilot districts: **Wayanad, Kerala** (landslide),
**Ganjam, Odisha** (cyclone / coastal erosion), and **Chamoli,
Uttarakhand** (landslide / flood / cloudburst — see `docs/METHODOLOGY.md`
§7.1 for the named glacial-hazard limitation this district's real
dominant hazard class is not yet modelled against).

See `CLAUDE.md` for the full domain summary, tech stack, coding
conventions, and build roadmap. See `docs/ARCHITECTURE.md` and
`docs/METHODOLOGY.md` for system design and the risk/vulnerability/
priority/suitability/capacity formulas.

> **Status:** Feature-complete for the hackathon build (Steps 1-9 of the
> roadmap in `CLAUDE.md`) — hazard zoning, vulnerability/priority scoring,
> candidate site matching, the officer decision workbench with a
> hash-chained audit trail, a what-if scenario simulator, an authority
> dashboard, and printable situation/assessment reports are all live.
> What's left is rehearsal and bug-fixing, not new features.

## Monorepo Layout

```
apps/web        React + Vite + TypeScript frontend (map, dashboard, reports)
apps/api        Express + TypeScript API (auth, RBAC, audit, orchestrates services/ml)
services/ml     Python FastAPI ML service (hazard/vulnerability/suitability models)
packages/shared Shared TypeScript types, Zod schemas, and config (weights/thresholds/RBAC)
data/           raw/, processed/, seed/, db/ (see data/README.md)
docs/           architecture, methodology, data sources, security
```

## Prerequisites

- **Node.js** >= 20 and npm >= 10
- **Python** 3.11
- Internet access on first `npm install` (downloads a real `mongod`
  binary via `mongodb-memory-server`'s postinstall step — see "Database"
  below; no separate MongoDB install needed)

## One-Time Setup

```bash
# 1. Install JS/TS dependencies for all workspaces (also downloads the
#    mongod binary used by npm run dev:mongo below)
npm install

# 2. Set up the Python ML service
cd services/ml
python -m venv venv
venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
cd ../..

# 3. Copy environment templates (defaults work as-is for local dev/demo)
cp apps/api/.env.example apps/api/.env
cp services/ml/.env.example services/ml/.env
```

## Database

`npm run dev` (see below) starts a **real, persistent** `mongod` — not an
in-memory/ephemeral database. `apps/api/src/scripts/devMongo.ts` runs it
against an on-disk dbpath at `data/db/` (gitignored), so seeded and
scored data survives every restart, a crash, or the machine sleeping —
this matters on demo day. To wipe the demo database and start over,
stop everything and delete `data/db/`.

## From a Clean Machine to a Full Working Demo

This is the one documented path — verified end-to-end this session
against a freshly emptied `data/db/`.

```bash
# Terminal 1 — start mongo + the shared package watcher + web + api + ml together
npm run dev
```

Wait for all five to report ready (`[mongo]`, `[shared]`, `[web]`,
`[api] PRAHARI API listening...`, `[ml]` uvicorn's "Application startup
complete"), then in a second terminal:

```bash
# Terminal 2 — seed, build the hazard grid, and score everything, in one command
npm run demo:reset
```

This is `scripts/resetDemo.mjs`, chaining the five steps below in order.
**It is the recovery command** — every step is independently idempotent
(seed: natural-key upserts, with pipeline-computed fields written only
`$setOnInsert` so a re-seed never wipes an already-scored site's
suitability data or an already-computed hazard zone back to a
placeholder; generate-grid/ingest-factors: upsert by h3Index; the
pipeline: re-scores a district from scratch every time it's run) — so if
anything looks wrong on demo day (a district's map looks stale, scores
look missing, a recommendation shows blank suitability data), re-running
`npm run demo:reset` against the already-running stack (`npm run dev` in
the other terminal) always gets you back to a fully seeded, fully scored
state for all three districts, safely, from whatever state the database
is currently in:

```bash
# 1. Seed districts, habitations, hazard zones/events, relocation sites, and demo users
npm run seed --workspace=@prahari/api

# 2. Fill each district's boundary with an H3 grid (writes data/processed/*-grid.json)
npm run generate-grid --workspace=@prahari/api

# 3. Derive synthetic-but-spatially-coherent causative factors for every grid cell
cd services/ml
venv\Scripts\python scripts/derive_factors.py     # Windows
# venv/bin/python scripts/derive_factors.py       # macOS/Linux
cd ../..

# 4. Load those factors onto each GridCell document
npm run ingest-factors --workspace=@prahari/api

# 5. Run the full pipeline (hazard zoning -> vulnerability/priority -> site
#    matching) for every seeded district, over HTTP, and wait for it to finish
npm run run-pipeline --workspace=@prahari/api
```

Then open **http://localhost:5173** and sign in — the dashboard is the
landing page.

### Demo login credentials

Printed by `npm run seed` on every run (synthetic demo accounts only,
never reuse these anywhere real):

| Role | Email | Password |
| --- | --- | --- |
| Super Admin | `superadmin@prahari.gov.in` | `PRAHARI@DevDefault123` |
| State Admin (Kerala) | `stateadmin.kerala@prahari.gov.in` | `PRAHARI@DevDefault123` |
| State Admin (Uttarakhand) | `stateadmin.uttarakhand@prahari.gov.in` | `PRAHARI@DevDefault123` |
| District Officer (Wayanad) | `officer.wayanad@prahari.gov.in` | `PRAHARI@DevDefault123` |
| District Officer (Ganjam) | `officer.ganjam@prahari.gov.in` | `PRAHARI@DevDefault123` |
| District Officer (Chamoli) | `officer.chamoli@prahari.gov.in` | `PRAHARI@DevDefault123` |
| Analyst (Wayanad / Ganjam / Chamoli) | `analyst.wayanad@`, `analyst.ganjam@`, `analyst.chamoli@prahari.gov.in` | `PRAHARI@DevDefault123` |
| Analyst, state-level (Kerala / Odisha / Uttarakhand) | `analyst.kerala@`, `analyst.odisha@`, `analyst.uttarakhand@prahari.gov.in` | `PRAHARI@DevDefault123` |
| Field Volunteer (Wayanad / Ganjam / Chamoli) | `volunteer.wayanad@`, `volunteer.ganjam@`, `volunteer.chamoli@prahari.gov.in` | `PRAHARI@DevDefault123` |

Override the shared default via `SEED_DEFAULT_PASSWORD` (or
`SEED_PASSWORD_<ROLE>`) in `apps/api/.env` before seeding, if you want a
different password for your own local demo.

### The demo path

Login as `officer.wayanad` → dashboard (headline figures, the capacity
shortfall, needs-attention list) → Map (real hazard zones and terrain
relief) → click a habitation (e.g. Chooralmala or Mundakkai, the real
2024 landslide site) → open its recommendation → Approve with a
justification → see the chain-verified audit badge → open the scenario
panel, run a preset (e.g. "2024 Wayanad event: 372 mm/24h") → see the
delta. `apps/web/e2e/*.spec.ts` (run with `PRAHARI_E2E_BACKEND=1`)
exercises this same path as a standing regression check.

## Running Services Individually

```bash
npm run dev:mongo    # persistent mongod on 127.0.0.1:27117 (data/db/)
npm run dev:web       # http://localhost:5173
npm run dev:api       # http://localhost:4000
npm run dev:ml        # http://localhost:8000
npm run dev            # mongo + shared watcher + web + api + ml, all together
```

> `dev:ml` invokes the Windows venv path (`services\ml\venv\Scripts\python`)
> directly. On macOS/Linux, activate the venv and run
> `uvicorn app.main:app --reload --port 8000` from `services/ml` manually,
> or adjust the `dev:ml` script in the root `package.json`.

## Verifying Services Are Up

```bash
curl http://localhost:4000/health   # {"status":"ok","service":"prahari-api",...}
curl http://localhost:8000/health   # {"status":"ok","service":"prahari-ml",...}
```

`http://localhost:8000/docs` has the FastAPI interactive API docs.

## Tooling

```bash
npm run lint         # ESLint across web/api/shared
npm run format        # Prettier write across the repo
npm run typecheck     # TypeScript project references, all workspaces
npm run build          # Build shared, then web, then api
npm run test --workspace=@prahari/api   # Vitest (apps/api) — ephemeral in-memory Mongo, isolated from data/db/
cd services/ml && venv\Scripts\python -m pytest   # pytest (services/ml)
cd apps/web && PRAHARI_E2E_BACKEND=1 npx playwright test   # Playwright against a real running stack
```

## Contributing

Read `CLAUDE.md` before making changes — it defines the coding
conventions (TypeScript strict, no `any`, named exports, Zod validation
at every API boundary) and the MongoDB collection naming conventions
used throughout this repo.
