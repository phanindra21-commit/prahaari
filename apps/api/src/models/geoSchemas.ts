import { Schema } from "mongoose";

/**
 * Generic GeoJSON sub-schemas. `coordinates` is typed Mixed at the Mongoose
 * level (Mongoose has no native discriminated-union field type) — the
 * precise shape (Point vs Polygon vs MultiPolygon) is enforced by each
 * model's TypeScript Document interface and, at the API boundary, by the
 * corresponding Zod schema in packages/shared/src/schemas/common.ts.
 */
export const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

export const geoPolygonalSchema = new Schema(
  {
    type: { type: String, enum: ["Polygon", "MultiPolygon"], required: true },
    coordinates: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

/** Step 10 Part 3B: a route's geometry. */
export const geoLineStringSchema = new Schema(
  {
    type: { type: String, enum: ["LineString"], required: true },
    coordinates: { type: [[Number]], required: true },
  },
  { _id: false },
);
