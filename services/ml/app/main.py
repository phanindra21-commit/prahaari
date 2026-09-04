"""PunarVas ML service — FastAPI entrypoint.

Hazard zoning (weighted-overlay + ML susceptibility, Step 4) is live at
/zoning/run. Vulnerability/risk/priority scoring (Step 5) is live at
/assessment/run. Site-suitability models are added in a later build step
(see CLAUDE.md Build Roadmap).
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

from app.routes.assessment import router as assessment_router
from app.routes.zoning import router as zoning_router

app = FastAPI(
    title="PunarVas ML Service",
    description="Hazard susceptibility, vulnerability, and site-suitability models for PunarVas.",
    version="0.1.0",
)

app.include_router(zoning_router)
app.include_router(assessment_router)


class HealthCheckResponse(BaseModel):
    status: str
    service: str
    timestamp: str


@app.get("/health", response_model=HealthCheckResponse)
def health() -> HealthCheckResponse:
    return HealthCheckResponse(
        status="ok",
        service="punarvas-ml",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
