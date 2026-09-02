"""PunarVas ML service — FastAPI entrypoint.

Step 1 scaffold: only a health check endpoint. Hazard susceptibility,
vulnerability scoring, and site-suitability models are added in later
build steps (see CLAUDE.md Build Roadmap).
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="PunarVas ML Service",
    description="Hazard susceptibility, vulnerability, and site-suitability models for PunarVas.",
    version="0.1.0",
)


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
