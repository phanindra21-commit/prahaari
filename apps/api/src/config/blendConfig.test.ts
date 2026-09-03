import { describe, it, expect } from "vitest";
import { blendConfig } from "@punarvas/shared";
import { HAZARD_TYPES } from "@punarvas/shared";

describe("blend-config.json", () => {
  it("declares a per-hazard alpha in [0, 1], defaulting to 0.6 favoring the interpretable overlay", () => {
    for (const hazard of HAZARD_TYPES) {
      const entry = blendConfig.hazards[hazard];
      expect(entry.alpha).toBeGreaterThanOrEqual(0);
      expect(entry.alpha).toBeLessThanOrEqual(1);
      expect(entry.alpha).toBe(0.6);
    }
  });
});
