import { describe, it, expect } from "vitest";
import { Job } from "./Job";
import { User } from "./User";
import { hashPassword } from "../lib/password";

describe("Job model", () => {
  it("defaults to PENDING with 0 progress", async () => {
    const user = await User.create({
      name: "Analyst",
      email: "job-model-test@prahari.gov.in",
      passwordHash: await hashPassword("SomePassw0rd!23"),
      role: "ANALYST",
      scope: {},
      isActive: true,
    });
    const job = await Job.create({
      type: "ZONING_RUN",
      districtId: user._id, // any valid ObjectId for this unit test — no District doc needed
      params: { districtId: user._id.toString(), hazardTypes: ["landslide"] },
      createdBy: user._id,
    });
    expect(job.status).toBe("PENDING");
    expect(job.progressPercent).toBe(0);
    expect(job.startedAt).toBeNull();
  });
});
