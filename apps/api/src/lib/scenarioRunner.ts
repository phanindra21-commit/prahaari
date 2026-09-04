import { Types } from "mongoose";
import type { HazardType, ScenarioParameters } from "@punarvas/shared";
import { District } from "../models/District";
import { GridCell } from "../models/GridCell";
import { Habitation, type HabitationDoc } from "../models/Habitation";
import { HazardEvent } from "../models/HazardEvent";
import { ScenarioRun, type ScenarioRunDoc } from "../models/ScenarioRun";
import { slugify } from "./h3Grid";
import {
  mlServiceClient,
  type ScenarioRunCellInput,
  type ScenarioRunHabitationInput,
  type AssessmentRunHazardEventInput,
} from "./mlServiceClient";

/**
 * Step 8 Part 2 — runs a what-if scenario for one district and persists
 * the result onto a new ScenarioRun document. Nothing else is written:
 * no HazardZone, no Assessment, no GridCell mutation — the district's
 * active zoning is completely untouched (services/ml/app/engine/
 * scenario.py never sees a database connection either; every input is
 * gathered here and sent in the request body, same stateless-engine
 * convention as every other pipeline stage).
 *
 * Trains on this ONE district's cells only, not the multi-district pool
 * the live zoning job uses (zoningJob.ts) — a documented simplification
 * (see scenario.py's module docstring) that keeps a scenario run
 * self-contained and fast; it does not change which zone-classification
 * thresholds or blend weights apply, only the population the ML model is
 * fit against.
 */
export async function runDistrictScenario(
  districtId: Types.ObjectId,
  name: string,
  parameters: ScenarioParameters,
  createdBy: Types.ObjectId,
): Promise<ScenarioRunDoc> {
  const district = await District.findById(districtId);
  if (!district) {
    throw Object.assign(new Error(`District ${districtId.toString()} not found`), { status: 404 });
  }

  const hazardTypes = district.primaryHazards;
  const slug = slugify(district.name);

  const gridCells = await GridCell.find({ districtId });
  const hazardCells: Partial<Record<HazardType, ScenarioRunCellInput[]>> = {};
  for (const hazard of hazardTypes) {
    const cells: ScenarioRunCellInput[] = [];
    for (const cell of gridCells) {
      const factors = cell.factors[hazard] as Record<string, number> | undefined;
      if (!factors) continue;
      cells.push({
        h3Index: cell.h3Index,
        district: slug,
        lon: cell.centroid.coordinates[0],
        lat: cell.centroid.coordinates[1],
        factors,
      });
    }
    if (cells.length === 0) {
      throw Object.assign(
        new Error(
          `No GridCell documents have factors.${hazard} for this district — run generate-grid, ` +
            "derive_factors.py, then ingest-factors first.",
        ),
        { status: 422 },
      );
    }
    hazardCells[hazard] = cells;
  }

  const hazardEventDocs = await HazardEvent.find({
    districtId,
    hazardType: { $in: hazardTypes },
    "extent.type": "Point",
  });
  const hazardEventPoints: Partial<Record<HazardType, [number, number][]>> = {};
  const hazardEvents: AssessmentRunHazardEventInput[] = [];
  for (const event of hazardEventDocs) {
    const [lon, lat] = (event.extent as { coordinates: [number, number] }).coordinates;
    (hazardEventPoints[event.hazardType] ??= []).push([lon, lat]);
    hazardEvents.push({ hazardType: event.hazardType, lon, lat, date: event.date.toISOString() });
  }

  const habitations = await Habitation.find({ districtId });
  if (habitations.length === 0) {
    throw Object.assign(new Error("No habitations found for this district."), { status: 422 });
  }
  const habitationById = new Map<string, HabitationDoc>(
    habitations.map((h) => [(h._id as Types.ObjectId).toString(), h]),
  );
  const habitationInputs: ScenarioRunHabitationInput[] = habitations.map((h) => ({
    habitationId: (h._id as Types.ObjectId).toString(),
    lon: h.centroid.coordinates[0],
    lat: h.centroid.coordinates[1],
    households: h.households,
    demographics: h.demographics as unknown as Record<string, number>,
    structures: h.structures as unknown as Record<string, unknown>,
    access: h.access as unknown as Record<string, unknown>,
    livelihood: h.livelihood as unknown as Record<string, unknown>,
    copingCapacity: h.copingCapacity as unknown as Record<string, unknown>,
  }));

  const response = await mlServiceClient.runScenario(
    hazardCells,
    hazardEventPoints,
    habitationInputs,
    hazardEvents,
    parameters,
  );

  const modelVersion = `scenario-v1-${Date.now()}`;

  return ScenarioRun.create({
    name,
    districtId,
    hazardTypes,
    parameters,
    hazardSummaries: response.hazardSummaries.map((s) => ({
      hazardType: s.hazard,
      affected: s.affected,
      baselineZoneCounts: s.baselineZoneCounts,
      scenarioZoneCounts: s.scenarioZoneCounts,
      cellsChanged: s.cellsChanged,
      newlyRedCells: s.newlyRedCells,
    })),
    cellTransitions: response.cellTransitions.map((t) => ({
      hazardType: t.hazard,
      fromZoneClass: t.fromClass,
      toZoneClass: t.toClass,
      cellCount: t.cellCount,
    })),
    habitationDeltas: response.habitationDeltas.map((d) => {
      const habitation = habitationById.get(d.habitationId);
      if (!habitation) {
        throw new Error(`ML service returned a delta for unknown habitationId ${d.habitationId}`);
      }
      return {
        habitationId: habitation._id as Types.ObjectId,
        habitationName: habitation.name,
        baselineOverallZoneClass: d.baselineOverallZoneClass,
        scenarioOverallZoneClass: d.scenarioOverallZoneClass,
        baselinePriorityBucket: d.baselinePriorityBucket,
        scenarioPriorityBucket: d.scenarioPriorityBucket,
        enteredImmediate: d.enteredImmediate,
        zoneClassWorsened: d.zoneClassWorsened,
      };
    }),
    habitationsEnteringImmediate: response.habitationsEnteringImmediate.map((id) => {
      const habitation = habitationById.get(id);
      return habitation ? habitation.name : id;
    }),
    zoneGeometries: response.zoneGeometries.map((g) => ({
      hazardType: g.hazard,
      baseline: g.baseline,
      scenario: g.scenario,
      changed: g.changed,
    })),
    runtimeSeconds: response.runtimeSeconds,
    modelVersion,
    createdBy,
  });
}
