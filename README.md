# PunarVas

Human-in-the-Loop AI + GIS decision-support platform for proactive hazard
zoning and relocation of vulnerable habitations in India. Built for Smart
India Hackathon. Pilot districts: **Wayanad, Kerala** (landslide) and
**Ganjam, Odisha** (cyclone / coastal erosion).

See `CLAUDE.md` for the full domain summary, tech stack, coding
conventions, and build roadmap. See `docs/ARCHITECTURE.md` and
`docs/METHODOLOGY.md` for system design and the risk/vulnerability/
priority/suitability/capacity formulas.

> **Status:** Step 1 of the build — repository scaffold only. No
> application logic, models, or routes are implemented yet.

## Monorepo Layout

```
apps/web        React + Vite + TypeScript frontend
apps/api        Express + TypeScript API
services/ml     Python FastAPI ML service
packages/shared Shared TypeScript types/constants
data/           raw/, processed/, seed/ datasets (see data/README.md)
docs/           architecture, methodology, data sources
```

## Prerequisites

- **Node.js** >= 20 and npm >= 10
- **Python** 3.11
- **MongoDB** running locally (or a connection string) — only needed once
  `apps/api` starts persisting data (Step 2 onward); not required to run
  the Step 1 hello-world endpoints.

## Setup

```bash
# 1. Install JS/TS dependencies for all workspaces (web, api, shared)
npm install

# 2. Build the shared types package (web and api both depend on it)
npm run build --workspace=@punarvas/shared

# 3. Set up the Python ML service
cd services/ml
python -m venv venv
venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
cd ../..

# 4. Copy environment templates
cp apps/api/.env.example apps/api/.env
cp services/ml/.env.example services/ml/.env
```

## Running the Services

From the repo root, each service can be run individually or all together:

```bash
npm run dev:web     # http://localhost:5173
npm run dev:api     # http://localhost:4000
npm run dev:ml      # http://localhost:8000
npm run dev          # all three concurrently
```

> `dev:ml` invokes the Windows venv path (`services\ml\venv\Scripts\python`)
> directly. On macOS/Linux, activate the venv and run
> `uvicorn app.main:app --reload --port 8000` from `services/ml` manually,
> or adjust the `dev:ml` script in the root `package.json`.

## Verifying All Three Services Start

```bash
# Web — should return HTML for the Vite dev server
curl -I http://localhost:5173

# API — should return {"status":"ok","service":"punarvas-api",...}
curl http://localhost:4000/health

# ML — should return {"status":"ok","service":"punarvas-ml",...}
curl http://localhost:8000/health
```

Or open `http://localhost:5173` in a browser to see the placeholder page,
and `http://localhost:8000/docs` for the FastAPI interactive docs.

## Tooling

```bash
npm run lint         # ESLint across web/api/shared
npm run format        # Prettier write across the repo
npm run typecheck     # TypeScript project references, all workspaces
npm run build          # Build shared, then web, then api
```

## Contributing

Read `CLAUDE.md` before making changes — it defines the coding
conventions (TypeScript strict, no `any`, named exports, Zod validation
at every API boundary) and the MongoDB collection naming conventions
used throughout this repo.
