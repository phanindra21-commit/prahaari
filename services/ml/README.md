# PunarVas ML Service

Python 3.11 + FastAPI service for hazard susceptibility, vulnerability scoring,
and site-suitability models. See the root `CLAUDE.md` and `docs/METHODOLOGY.md`
for the modeling approach.

## Setup

```bash
cd services/ml
python -m venv venv

# Windows (PowerShell)
venv\Scripts\Activate.ps1

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

## Run (dev)

```bash
uvicorn app.main:app --reload --port 8000
```

Or via the root workspace script:

```bash
npm run dev:ml
```

## Verify

```bash
curl http://localhost:8000/health
```

Interactive API docs: http://localhost:8000/docs
