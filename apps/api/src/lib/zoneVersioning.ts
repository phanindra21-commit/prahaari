import type { Types } from "mongoose";
import type { HazardType, ZoneClass, GeneratedBy, DataProvenance, GeoPolygonal } from "@punarvas/shared";
import { HazardZone, type HazardZoneDoc } from "../models/HazardZone";

/**
 * `HazardZone` documents are never mutated — see the model's docstring.
 * `writeZoneVersion()` is the only supported way to write a new zoning run:
 * it inserts the new set of zone-class polygons for one (district, hazard)
 * and closes (`validTo`) every previously-active doc for that same
 * (district, hazard), regardless of whether the new run reproduces every
 * old zone class. A new doc's `supersedes` points at the previously-active
 * doc of the SAME zoneClass, if one existed — a class that simply drops
 * out between runs (e.g. no cell reached Red this time) still gets closed
 * with no successor, which is correct, not an orphan.
 */
export interface ZoneVersionInput {
  zoneClass: ZoneClass;
  geometry: GeoPolygonal;
  simplifiedGeometry?: GeoPolygonal;
  hazardScore: number;
  factorContributions: Record<string, number>;
  modelVersion: string;
  generatedBy: GeneratedBy;
  dataProvenance: DataProvenance;
  sourceUrl?: string;
}

export interface WriteZoneVersionResult {
  created: HazardZoneDoc[];
  supersededCount: number;
}

export async function writeZoneVersion(
  districtId: Types.ObjectId,
  hazardType: HazardType,
  zones: ZoneVersionInput[],
  at: Date = new Date(),
): Promise<WriteZoneVersionResult> {
  const active = await HazardZone.find({ districtId, hazardType, validTo: null });
  const activeByClass = new Map(active.map((doc) => [doc.zoneClass, doc]));

  const created = await HazardZone.insertMany(
    zones.map((zone) => {
      const doc: Record<string, unknown> = {
        districtId,
        hazardType,
        geometry: zone.geometry,
        zoneClass: zone.zoneClass,
        hazardScore: zone.hazardScore,
        factorContributions: new Map(Object.entries(zone.factorContributions)),
        modelVersion: zone.modelVersion,
        validFrom: at,
        validTo: null,
        generatedBy: zone.generatedBy,
        supersedes: activeByClass.get(zone.zoneClass)?._id ?? null,
        dataProvenance: zone.dataProvenance,
      };
      if (zone.simplifiedGeometry) {
        doc.simplifiedGeometry = zone.simplifiedGeometry;
      }
      if (zone.sourceUrl) {
        doc.sourceUrl = zone.sourceUrl;
      }
      return doc;
    }),
  );

  if (active.length > 0) {
    await HazardZone.updateMany(
      { _id: { $in: active.map((doc) => doc._id) } },
      { $set: { validTo: at } },
    );
  }

  return { created: created as unknown as HazardZoneDoc[], supersededCount: active.length };
}

export interface ActiveZoneQuery {
  districtId: Types.ObjectId;
  hazardType?: HazardType;
  at?: Date;
}

/** Zones valid at `at` (default now): validFrom <= at AND (validTo is null OR validTo > at). */
export async function getActiveZones(query: ActiveZoneQuery): Promise<HazardZoneDoc[]> {
  const at = query.at ?? new Date();
  const filter: Record<string, unknown> = {
    districtId: query.districtId,
    validFrom: { $lte: at },
    $or: [{ validTo: null }, { validTo: { $gt: at } }],
  };
  if (query.hazardType) {
    filter.hazardType = query.hazardType;
  }
  return HazardZone.find(filter);
}
