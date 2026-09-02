import { z } from "zod";
import { objectIdSchema, geoPolygonalSchema, hazardTypeSchema, timestampsSchema } from "./common";

export const dmAuthorityContactSchema = z.object({
  name: z.string().min(1),
  designation: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
});
export type DmAuthorityContact = z.infer<typeof dmAuthorityContactSchema>;

export const districtSchema = z
  .object({
    _id: objectIdSchema,
    lgdCode: z.string().min(1),
    name: z.string().min(1),
    state: z.string().min(1),
    boundary: geoPolygonalSchema,
    population: z.number().int().nonnegative(),
    areaSqKm: z.number().positive(),
    primaryHazards: z.array(hazardTypeSchema).min(1),
    dmAuthorityContact: dmAuthorityContactSchema,
  })
  .merge(timestampsSchema);
export type District = z.infer<typeof districtSchema>;
