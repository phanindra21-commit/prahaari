"""PRAHARI ML service — FastAPI entrypoint.

Hazard zoning (weighted-overlay + ML susceptibility, Step 4) is live at
/zoning/run. Vulnerability/risk/priority scoring (Step 5) is live at
/assessment/run. Relocation-site exclusions/suitability/capacity/matching
(Step 7 Commit 2) is live at /sites/run. What-if scenario simulation
(Step 8 Part 2) is live at /scenarios/run.
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

from app.routes.assessment import router as assessment_router
from app.routes.scenarios import router as scenarios_router
from app.routes.sites import router as sites_router
from app.routes.zoning import router as zoning_router

app = FastAPI(
    title="PRAHARI ML Service",
    description="Hazard susceptibility, vulnerability, and site-suitability models for PRAHARI.",
    version="0.1.0",
)

app.include_router(zoning_router)
app.include_router(assessment_router)
app.include_router(sites_router)
app.include_router(scenarios_router)


class HealthCheckResponse(BaseModel):
    status: str
    service: str
    timestamp: str


@app.get("/health", response_model=HealthCheckResponse)
def health() -> HealthCheckResponse:
    return HealthCheckResponse(
        status="ok",
        service="prahari-ml",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
