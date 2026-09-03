import { z } from "zod";
import { USER_ROLES } from "../constants";

const zoneClassEnum = z.enum(["Red", "Orange", "Yellow", "Green"]);

const factorWeightsSchema = z.record(z.string(), z.number().min(0).max(1));

export const hazardWeightsSchema = z.object({
  modelVersion: z.string(),
  hazards: z.object({
    landslide: z.object({ factors: factorWeightsSchema }),
    flood: z.object({ factors: factorWeightsSchema }),
    coastalErosion: z.object({ factors: factorWeightsSchema }),
    cloudburst: z.object({ factors: factorWeightsSchema }),
  }),
});
export type HazardWeightsConfig = z.infer<typeof hazardWeightsSchema>;

const hazardThresholdSchema = z.object({
  red: z.number().min(0).max(1),
  orange: z.number().min(0).max(1),
  yellow: z.number().min(0).max(1),
});

export const zoneThresholdsSchema = z.object({
  modelVersion: z.string(),
  classes: z.array(zoneClassEnum),
  note: z.string(),
  perHazard: z.object({
    landslide: hazardThresholdSchema,
    flood: hazardThresholdSchema,
    coastalErosion: hazardThresholdSchema,
    cloudburst: hazardThresholdSchema,
  }),
  multiHazardAggregation: z.object({
    rule: z.string(),
    description: z.string(),
    orangeCountEscalationTrigger: z.number().int().positive(),
    escalatesTo: zoneClassEnum,
  }),
});
export type ZoneThresholdsConfig = z.infer<typeof zoneThresholdsSchema>;

const indicatorWeightsSchema = z.record(z.string(), z.number().min(0).max(1));

const vulnerabilityDimensionSchema = z.object({
  weight: z.number().min(0).max(1),
  indicators: indicatorWeightsSchema,
});

export const vulnerabilityWeightsSchema = z.object({
  modelVersion: z.string(),
  note: z.string(),
  dimensions: z.object({
    demographic: vulnerabilityDimensionSchema,
    socioeconomic: vulnerabilityDimensionSchema,
    structural: vulnerabilityDimensionSchema,
    accessibility: vulnerabilityDimensionSchema,
  }),
  copingCapacity: z.object({
    usage: z.literal("RISK_DIVISOR_ONLY"),
    indicators: indicatorWeightsSchema,
  }),
});
export type VulnerabilityWeightsConfig = z.infer<typeof vulnerabilityWeightsSchema>;

export const priorityWeightsSchema = z.object({
  modelVersion: z.string(),
  note: z.string(),
  weights: z.object({
    risk: z.number().min(0).max(1),
    vulnerability: z.number().min(0).max(1),
  }),
  buckets: z.object({
    note: z.string(),
    immediate: z.number().min(0).max(1),
    shortTerm: z.number().min(0).max(1),
  }),
});
export type PriorityWeightsConfig = z.infer<typeof priorityWeightsSchema>;

export const suitabilityAhpSchema = z.object({
  modelVersion: z.string(),
  note: z.string(),
  criteria: z.array(z.string()).min(2),
  pairwiseMatrix: z.array(z.array(z.number().positive())),
  weights: z.record(z.string(), z.number().min(0).max(1)),
  lambdaMax: z.number().positive(),
  consistencyIndex: z.number(),
  randomIndex: z.number().positive(),
  consistencyRatio: z.number(),
});
export type SuitabilityAhpConfig = z.infer<typeof suitabilityAhpSchema>;

export const capacityNormsSchema = z.object({
  modelVersion: z.string(),
  water: z.object({
    lpcd: z.number().positive(),
    source: z.string(),
    defaultAvgHouseholdSize: z.number().positive(),
    stateAvgHouseholdSize: z.record(z.string(), z.number().positive()),
  }),
  land: z.object({
    plotAreaPerHouseholdSqm: z.number().positive(),
    infrastructureOverheadFactor: z.number().positive(),
    effectiveLandPerHouseholdSqm: z.number().positive(),
  }),
  education: z.object({
    rte: z.object({
      primarySchoolMaxDistanceKm: z.number().positive(),
      upperPrimarySchoolMaxDistanceKm: z.number().positive(),
      pupilTeacherRatioPrimary: z.number().positive(),
      pupilTeacherRatioUpperPrimary: z.number().positive(),
      schoolAgeChildrenShareOfPopulation: z.number().min(0).max(1),
    }),
  }),
  health: z.object({
    iphs: z.object({
      subCentrePopulationNormPlains: z.number().positive(),
      subCentrePopulationNormHillyTribal: z.number().positive(),
      phcPopulationNormPlains: z.number().positive(),
      phcPopulationNormHillyTribal: z.number().positive(),
      chcPopulationNormPlains: z.number().positive(),
      chcPopulationNormHillyTribal: z.number().positive(),
    }),
  }),
  access: z.object({
    allWeatherRoadMaxDistanceMeters: z.number().positive(),
    householdsPerAccessPointCapacity: z.number().positive(),
  }),
});
export type CapacityNormsConfig = z.infer<typeof capacityNormsSchema>;

export const exclusionCriterionRuleSchema = z.enum([
  "INTERSECTS_ZONE_CLASS",
  "INTERSECTS_LAYER",
  "SLOPE_EXCEEDS_DEGREES",
  "WITHIN_BUFFER",
]);

export const exclusionCriteriaSchema = z.object({
  modelVersion: z.string(),
  note: z.string(),
  criteria: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        rule: exclusionCriterionRuleSchema,
        params: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
});
export type ExclusionCriteriaConfig = z.infer<typeof exclusionCriteriaSchema>;

const factorDirectionSchema = z.enum(["DIRECT", "INVERSE"]);

const factorBreakpointSchema = z.object({
  max: z.number().nullable(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});

const factorReclassificationEntrySchema = z.object({
  direction: factorDirectionSchema,
  unit: z.string().min(1),
  breakpoints: z.array(factorBreakpointSchema).length(5),
});

export const factorReclassificationSchema = z.object({
  modelVersion: z.string().min(1),
  note: z.string(),
  hazards: z.record(z.string(), z.record(z.string(), factorReclassificationEntrySchema)),
});
export type FactorReclassificationConfig = z.infer<typeof factorReclassificationSchema>;

const blendHazardEntrySchema = z.object({
  alpha: z.number().min(0).max(1),
  note: z.string(),
});

export const blendConfigSchema = z.object({
  modelVersion: z.string().min(1),
  note: z.string(),
  hazards: z.object({
    landslide: blendHazardEntrySchema,
    flood: blendHazardEntrySchema,
    coastalErosion: blendHazardEntrySchema,
    cloudburst: blendHazardEntrySchema,
  }),
});
export type BlendConfig = z.infer<typeof blendConfigSchema>;

const permissionStringSchema = z
  .string()
  .regex(/^[a-zA-Z]+:[a-zA-Z]+$/, "Permission strings must be 'resource:action'");

const roleKeysShape = Object.fromEntries(
  USER_ROLES.map((role) => [role, z.array(permissionStringSchema)]),
) as Record<(typeof USER_ROLES)[number], z.ZodArray<typeof permissionStringSchema>>;

export const permissionsConfigSchema = z.object({
  modelVersion: z.string(),
  note: z.string(),
  permissions: z.array(permissionStringSchema).min(1),
  roles: z.object(roleKeysShape),
  separationOfDuties: z.object({
    note: z.string(),
    approverRoles: z.array(z.enum(USER_ROLES)).min(1),
  }),
});
export type PermissionsConfig = z.infer<typeof permissionsConfigSchema>;
