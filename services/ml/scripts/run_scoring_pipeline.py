"""Commit 2 status check: runs the weighted-overlay + ML scoring pipeline
for every hazard and prints per-hazard training metrics.

Every model here is trained on SYNTHETIC_DEMO labels (app/engine/labels.py)
— there is no real historical hazard inventory wired in yet.

Usage (from services/ml, with the venv active):
    python scripts/run_scoring_pipeline.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine.pipeline import score_hazard  # noqa: E402

HAZARDS = ["landslide", "flood", "coastalErosion", "cloudburst"]


def main() -> None:
    for hazard in HAZARDS:
        result = score_hazard(hazard)
        m = result.trained.metrics
        print(
            f"\n[run_scoring_pipeline] {hazard} ({', '.join(sorted(set(result.districts)))}) "
            f"— {len(result.h3_indexes)} cells, {result.labelled_count} labelled "
            f"({result.label_source}), {result.trained.training_sample_count} in the training split:"
        )
        print(
            f"[run_scoring_pipeline]   AUC-ROC={m['aucRoc']:.3f}  precision={m['precision']:.3f}  "
            f"recall={m['recall']:.3f}  F1={m['f1']:.3f}  calibrationError={m['calibrationError']:.3f}"
        )
        print(
            f"[run_scoring_pipeline]   overlay range=[{result.overlay_scores.min():.3f}, {result.overlay_scores.max():.3f}]  "
            f"ml range=[{result.ml_scores.min():.3f}, {result.ml_scores.max():.3f}]  "
            f"blended range=[{result.blended_scores.min():.3f}, {result.blended_scores.max():.3f}]"
        )


if __name__ == "__main__":
    main()
