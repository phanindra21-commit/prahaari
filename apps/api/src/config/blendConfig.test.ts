import { describe, it, expect } from "vitest";
import { blendConfig } from "@punarvas/shared";

describe("blend-config.json", () => {
  it("alpha is in [0, 1] and defaults to 0.6 favoring the interpretable overlay", () => {
    expect(blendConfig.alpha).toBeGreaterThanOrEqual(0);
    expect(blendConfig.alpha).toBeLessThanOrEqual(1);
    expect(blendConfig.alpha).toBe(0.6);
  });
});
