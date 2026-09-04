import type { Types } from "mongoose";
import type { HazardType, ZoneClass, RelocationPriorityBucket } from "@punarvas/shared";
import { Assessment, type AssessmentDoc, type ExplanationEntry, type CompoundHazardEntry } from "../models/Assessment";

/**
 * `Assessment` documents are never mutated — same pattern as HazardZone
 * (see zoneVersioning.ts). `writeAssessmentVersion()` inserts a new
 * Assessment for a habitation and closes (`validTo`) the previously-active
 * one, pointing the new doc's `supersedes` at it.
 */
export interface HazardExposureInput {
  hazardType: HazardType;
  hazardScore: number;
  exposure: number;
  zoneClass: ZoneClass;
  disasterHistoryBoost: number;
}

export interface AssessmentVersionInput {
  habitationId: Types.ObjectId;
  districtId: Types.ObjectId;
  hazardExposure: HazardExposureInput[];
  vulnerabilityIndex: number;
  vulnerabilityDimensions: {
    demographic: number;
    socioeconomic: number;
    structural: number;
    accessibility: number;
  };
  copingCapacity: number;
  compositeRiskScore: number;
  governingHazard: HazardType;
  relocationPriorityIndex: number | null;
  priorityBucket: RelocationPriorityBucket | null;
  modelVersion: string;
  explanation: ExplanationEntry[];
  /** The habitation's overall zone class (Red/Orange/Yellow/Green). */
  overallZoneClass: ZoneClass;
  compoundHazard: CompoundHazardEntry | null;
}

export interface WriteAssessmentVersionResult {
  created: AssessmentDoc[];
  supersededCount: number;
}

/** Writes ONE new Assessment version per habitation in `inputs`, closing whichever
 * doc was previously active for that habitation (if any). */
export async function writeAssessmentVersions(
  inputs: AssessmentVersionInput[],
  at: Date = new Date(),
): Promise<WriteAssessmentVersionResult> {
  if (inputs.length === 0) {
    return { created: [], supersededCount: 0 };
  }

  const habitationIds = inputs.map((input) => input.habitationId);
  const active = await Assessment.find({ habitationId: { $in: habitationIds }, validTo: null });
  const activeByHabitation = new Map(active.map((doc) => [doc.habitationId.toString(), doc]));

  const created = await Assessment.insertMany(
    inputs.map((input) => ({
      habitationId: input.habitationId,
      districtId: input.districtId,
      hazardExposure: input.hazardExposure,
      vulnerabilityIndex: input.vulnerabilityIndex,
      vulnerabilityDimensions: input.vulnerabilityDimensions,
      copingCapacity: input.copingCapacity,
      compositeRiskScore: input.compositeRiskScore,
      governingHazard: input.governingHazard,
      overallZoneClass: input.overallZoneClass,
      relocationPriorityIndex: input.relocationPriorityIndex,
      priorityBucket: input.priorityBucket,
      modelVersion: input.modelVersion,
      computedAt: at,
      validFrom: at,
      validTo: null,
      supersedes: activeByHabitation.get(input.habitationId.toString())?._id ?? null,
      explanation: input.explanation,
      compoundHazard: input.compoundHazard,
    })),
  );

  if (active.length > 0) {
    await Assessment.updateMany(
      { _id: { $in: active.map((doc) => doc._id) } },
      { $set: { validTo: at } },
    );
  }

  return { created: created as unknown as AssessmentDoc[], supersededCount: active.length };
}

export interface ActiveAssessmentQuery {
  habitationId: Types.ObjectId;
  at?: Date;
}

/** The Assessment valid at `at` (default now) for one habitation, or null if it has never been assessed. */
export async function getActiveAssessment(query: ActiveAssessmentQuery): Promise<AssessmentDoc | null> {
  const at = query.at ?? new Date();
  return Assessment.findOne({
    habitationId: query.habitationId,
    validFrom: { $lte: at },
    $or: [{ validTo: null }, { validTo: { $gt: at } }],
  });
}
