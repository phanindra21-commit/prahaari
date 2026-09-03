import { describe, it, expect } from "vitest";
import { ModelRun } from "./ModelRun";

describe("ModelRun model", () => {
  it("persists provenance for a trained susceptibility model", async () => {
    const doc = await ModelRun.create({
      modelVersion: "landslide-xgb-2026-09-03T00:00:00Z",
      hazardType: "landslide",
      algorithm: "xgboost-binary-classifier",
      trainedAt: new Date(),
      featureList: ["slope", "lithology", "landCover"],
      hyperparameters: { maxDepth: 4, nEstimators: 200, learningRate: 0.1 },
      metrics: { aucRoc: 0.81, precision: 0.7, recall: 0.65, f1: 0.67, calibrationError: 0.05 },
      trainingSampleCount: 600,
      labelSource: "SYNTHETIC_DEMO",
      notes: "Spatial block split; SYNTHETIC_DEMO positive/negative labels, not a real hazard inventory",
    });
    expect(doc.labelSource).toBe("SYNTHETIC_DEMO");
    expect(doc.metrics.aucRoc).toBe(0.81);
  });

  it("rejects a duplicate modelVersion", async () => {
    const base = {
      hazardType: "flood" as const,
      algorithm: "xgboost-binary-classifier",
      trainedAt: new Date(),
      featureList: ["elevation"],
      hyperparameters: {},
      metrics: { aucRoc: 0.7, precision: 0.6, recall: 0.6, f1: 0.6, calibrationError: 0.1 },
      trainingSampleCount: 100,
      labelSource: "SYNTHETIC_DEMO",
    };
    await ModelRun.create({ ...base, modelVersion: "flood-dup-test" });
    await expect(ModelRun.create({ ...base, modelVersion: "flood-dup-test" })).rejects.toThrow();
  });
});
