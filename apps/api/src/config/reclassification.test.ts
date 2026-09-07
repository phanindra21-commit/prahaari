import { describe, it, expect } from "vitest";
import { factorReclassification, hazardWeights } from "@prahari/shared";

describe("factor-reclassification.json", () => {
  it("declares a reclassification entry for every hazard-weights factor", () => {
    for (const [hazard, hazardConfig] of Object.entries(hazardWeights.hazards)) {
      const reclassHazard = factorReclassification.hazards[hazard];
      expect(reclassHazard, `missing hazard ${hazard}`).toBeDefined();
      expect(Object.keys(reclassHazard ?? {}).sort()).toEqual(
        Object.keys(hazardConfig.factors).sort(),
      );
    }
  });

  it("marks known protective/distance factors as INVERSE", () => {
    expect(factorReclassification.hazards.coastalErosion?.mangroveDuneBufferPresence?.direction).toBe(
      "INVERSE",
    );
    expect(factorReclassification.hazards.cloudburst?.drainageCapacity?.direction).toBe("INVERSE");
  });
});
