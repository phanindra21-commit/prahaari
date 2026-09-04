import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { Assessment } from "../models/Assessment";
import {
  writeAssessmentVersions,
  getActiveAssessment,
  type AssessmentVersionInput,
} from "./assessmentVersioning";

function baseInput(
  habitationId: Types.ObjectId,
  overrides: Partial<AssessmentVersionInput> = {},
): AssessmentVersionInput {
  return {
    habitationId,
    districtId: new Types.ObjectId(),
    hazardExposure: [{ hazardType: "landslide", hazardScore: 0.7, exposure: 0.8, zoneClass: "Orange" }],
    vulnerabilityIndex: 0.5,
    vulnerabilityDimensions: { demographic: 0.4, socioeconomic: 0.5, structural: 0.5, accessibility: 0.5 },
    copingCapacity: 0.3,
    compositeRiskScore: 0.4,
    governingHazard: "landslide",
    relocationPriorityIndex: 0.6,
    priorityBucket: "ShortTerm",
    modelVersion: "v1",
    explanation: [{ factor: "risk", contribution: 0.3, direction: "INCREASES_RISK", label: "Overall risk" }],
    overallZoneClass: "Orange",
    ...overrides,
  };
}

describe("assessmentVersioning", () => {
  it("first run: creates an assessment with no supersession", async () => {
    const habitationId = new Types.ObjectId();
    const result = await writeAssessmentVersions([baseInput(habitationId)]);

    expect(result.created).toHaveLength(1);
    expect(result.supersededCount).toBe(0);
    expect(result.created[0]!.validTo).toBeNull();
    expect(result.created[0]!.supersedes).toBeNull();
  });

  it("second run closes the previous assessment and supersedes it", async () => {
    const habitationId = new Types.ObjectId();
    const t1 = new Date();
    const t2 = new Date(Date.now() + 60_000);

    const run1 = await writeAssessmentVersions([baseInput(habitationId, { modelVersion: "v1" })], t1);
    const run2 = await writeAssessmentVersions(
      [baseInput(habitationId, { modelVersion: "v2", relocationPriorityIndex: 0.8, priorityBucket: "Immediate" })],
      t2,
    );

    expect(run2.supersededCount).toBe(1);
    expect(run2.created[0]!.supersedes?.toString()).toBe(run1.created[0]!._id.toString());

    const closed = await Assessment.findById(run1.created[0]!._id);
    expect(closed?.validTo?.getTime()).toBe(t2.getTime());

    const active = await getActiveAssessment({ habitationId, at: t2 });
    expect(active?._id.toString()).toBe(run2.created[0]!._id.toString());
    expect(active?.priorityBucket).toBe("Immediate");
  });

  it("persists a Yellow/Green habitation's assessment with a null RPI and bucket", async () => {
    const habitationId = new Types.ObjectId();
    const result = await writeAssessmentVersions([
      baseInput(habitationId, {
        relocationPriorityIndex: null,
        priorityBucket: null,
        overallZoneClass: "Green",
        explanation: [],
      }),
    ]);

    const doc = result.created[0]!;
    expect(doc.relocationPriorityIndex).toBeNull();
    expect(doc.priorityBucket).toBeNull();
    expect(doc.vulnerabilityIndex).toBe(0.5); // still "recorded as assessed"
  });

  it("writes multiple habitations' versions in one call without cross-contaminating supersession", async () => {
    const habitationA = new Types.ObjectId();
    const habitationB = new Types.ObjectId();

    const run1 = await writeAssessmentVersions([baseInput(habitationA), baseInput(habitationB)]);
    expect(run1.supersededCount).toBe(0);

    const run2 = await writeAssessmentVersions([baseInput(habitationA)], new Date(Date.now() + 1000));
    expect(run2.supersededCount).toBe(1);
    expect(run2.created[0]!.supersedes?.toString()).toBe(
      run1.created.find((d) => d.habitationId.toString() === habitationA.toString())!._id.toString(),
    );

    // Habitation B's assessment from run1 must still be active/untouched.
    const stillActiveB = await getActiveAssessment({ habitationId: habitationB });
    expect(stillActiveB).not.toBeNull();
    expect(stillActiveB?.validTo).toBeNull();
  });

  it("getActiveAssessment returns null for a never-assessed habitation", async () => {
    const result = await getActiveAssessment({ habitationId: new Types.ObjectId() });
    expect(result).toBeNull();
  });
});
