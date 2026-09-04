import { Types } from "mongoose";
import type { HazardType, RelocationPriorityBucket } from "@punarvas/shared";
import { Habitation } from "../../models/Habitation";
import { HazardEvent } from "../../models/HazardEvent";
import { getActiveZones } from "../zoneVersioning";
import { writeAssessmentVersions, type AssessmentVersionInput } from "../assessmentVersioning";
import {
  mlServiceClient,
  type AssessmentRunZoneEntry,
  type AssessmentRunHabitationInput,
  type AssessmentRunHazardEventInput,
} from "../mlServiceClient";

export interface AssessmentStageSummary {
  habitationCount: number;
  bucketCounts: Record<RelocationPriorityBucket | "unbucketed", number>;
  modelVersion: string;
}

/**
 * Assesses every habitation in a district against the district's currently
 * active hazard zones: hazard exposure (area-weighted), VI + coping
 * capacity, Risk, and — for a Red/Orange overall zone class — RPI +
 * priority bucket. Persists one Assessment version per habitation
 * (assessmentVersioning.ts) and returns a summary for Job.result /
 * audit().
 */
export async function assessDistrictHabitations(
  districtId: Types.ObjectId,
  hazardTypes: HazardType[],
): Promise<AssessmentStageSummary> {
  const hazardTypeSet = new Set(hazardTypes);
  const activeZones = (await getActiveZones({ districtId })).filter((zone) =>
    hazardTypeSet.has(zone.hazardType),
  );
  if (activeZones.length === 0) {
    throw new Error(
      `No active HazardZone documents for this district's requested hazards (${hazardTypes.join(", ")}) — ` +
        "run the zoning stage before assessments.",
    );
  }

  const hazardZones: Partial<Record<HazardType, AssessmentRunZoneEntry[]>> = {};
  for (const zone of activeZones) {
    const entry: AssessmentRunZoneEntry = {
      zoneClass: zone.zoneClass,
      geometry: zone.geometry,
      hazardScore: zone.hazardScore,
    };
    const existing = hazardZones[zone.hazardType];
    if (existing) {
      existing.push(entry);
    } else {
      hazardZones[zone.hazardType] = [entry];
    }
  }

  const habitations = await Habitation.find({ districtId });
  if (habitations.length === 0) {
    throw new Error("No habitations found for this district.");
  }

  const habitationInputs: AssessmentRunHabitationInput[] = habitations.map((habitation) => ({
    habitationId: (habitation._id as Types.ObjectId).toString(),
    lon: habitation.centroid.coordinates[0],
    lat: habitation.centroid.coordinates[1],
    households: habitation.households,
    demographics: habitation.demographics as unknown as Record<string, number>,
    structures: habitation.structures as unknown as Record<string, unknown>,
    access: habitation.access as unknown as Record<string, unknown>,
    livelihood: habitation.livelihood as unknown as Record<string, unknown>,
    copingCapacity: habitation.copingCapacity as unknown as Record<string, unknown>,
  }));

  // Only Point-extent events feed the disaster-history boost (disaster_history.py) —
  // same restriction run_zoning_pipeline.py's offline event-point extraction already
  // applies; every seeded HazardEvent today is a Point.
  const hazardEventDocs = await HazardEvent.find({
    districtId,
    hazardType: { $in: hazardTypes },
    "extent.type": "Point",
  });
  const hazardEventInputs: AssessmentRunHazardEventInput[] = hazardEventDocs.map((event) => {
    const [lon, lat] = (event.extent as { coordinates: [number, number] }).coordinates;
    return { hazardType: event.hazardType, lon, lat, date: event.date.toISOString() };
  });

  const response = await mlServiceClient.runAssessment(hazardZones, habitationInputs, hazardEventInputs);
  const modelVersion = `assessment-v1-${Date.now()}`;
  const habitationById = new Map(habitations.map((h) => [(h._id as Types.ObjectId).toString(), h]));

  const inputs: AssessmentVersionInput[] = response.assessments.map((assessment) => {
    const habitation = habitationById.get(assessment.habitationId);
    if (!habitation) {
      throw new Error(`ML service returned an assessment for unknown habitationId ${assessment.habitationId}`);
    }
    return {
      habitationId: habitation._id as Types.ObjectId,
      districtId,
      hazardExposure: assessment.hazardExposure.map((e) => ({
        hazardType: e.hazardType,
        hazardScore: e.hazardScore,
        exposure: e.exposure,
        zoneClass: e.zoneClass,
        disasterHistoryBoost: e.disasterHistoryBoost,
      })),
      vulnerabilityIndex: assessment.vulnerabilityIndex,
      vulnerabilityDimensions: assessment.vulnerabilityDimensions,
      copingCapacity: assessment.copingCapacity,
      compositeRiskScore: assessment.compositeRiskScore,
      governingHazard: assessment.governingHazard,
      relocationPriorityIndex: assessment.relocationPriorityIndex,
      priorityBucket: assessment.priorityBucket,
      modelVersion,
      // The ML service always sends a label (Pydantic requires it as a
      // non-optional str for assessment explanations); the `?? factor`
      // fallback exists only to satisfy the shared ExplanationEntry type,
      // which leaves label optional for GridCell's Step 4 SHAP entries.
      explanation: assessment.explanation.map((entry) => ({ ...entry, label: entry.label ?? entry.factor })),
      overallZoneClass: assessment.overallZoneClass,
    };
  });

  await writeAssessmentVersions(inputs);

  const bucketCounts: AssessmentStageSummary["bucketCounts"] = {
    Immediate: 0,
    ShortTerm: 0,
    MediumTerm: 0,
    unbucketed: 0,
  };
  for (const input of inputs) {
    if (input.priorityBucket) {
      bucketCounts[input.priorityBucket] += 1;
    } else {
      bucketCounts.unbucketed += 1;
    }
  }

  return { habitationCount: habitations.length, bucketCounts, modelVersion };
}
