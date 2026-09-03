import type { ZodSchema } from "zod";
import hazardWeightsJson from "./hazard-weights.json";
import zoneThresholdsJson from "./zone-thresholds.json";
import factorReclassificationJson from "./factor-reclassification.json";
import blendConfigJson from "./blend-config.json";
import vulnerabilityWeightsJson from "./vulnerability-weights.json";
import priorityWeightsJson from "./priority-weights.json";
import suitabilityAhpJson from "./suitability-ahp.json";
import capacityNormsJson from "./capacity-norms.json";
import exclusionCriteriaJson from "./exclusion-criteria.json";
import permissionsJson from "./permissions.json";
import {
  hazardWeightsSchema,
  zoneThresholdsSchema,
  vulnerabilityWeightsSchema,
  priorityWeightsSchema,
  suitabilityAhpSchema,
  capacityNormsSchema,
  exclusionCriteriaSchema,
  factorReclassificationSchema,
  blendConfigSchema,
  permissionsConfigSchema,
  type HazardWeightsConfig,
  type ZoneThresholdsConfig,
  type VulnerabilityWeightsConfig,
  type PriorityWeightsConfig,
  type SuitabilityAhpConfig,
  type CapacityNormsConfig,
  type ExclusionCriteriaConfig,
  type FactorReclassificationConfig,
  type BlendConfig,
  type PermissionsConfig,
} from "./schemas";

const WEIGHT_SUM_TOLERANCE = 1e-6;

function parseConfig<T>(schema: ZodSchema<T>, data: unknown, fileName: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`[shared/config] Failed to validate ${fileName}: ${result.error.toString()}`);
  }
  return result.data;
}

function assertSumsToOne(weights: Record<string, number>, label: string): void {
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new Error(`[shared/config] ${label} must sum to 1.0, but summed to ${sum}`);
  }
}

function loadHazardWeights(): HazardWeightsConfig {
  const config = parseConfig(hazardWeightsSchema, hazardWeightsJson, "hazard-weights.json");
  for (const [hazard, hazardConfig] of Object.entries(config.hazards)) {
    assertSumsToOne(hazardConfig.factors, `hazard-weights.json hazards.${hazard}.factors`);
  }
  return config;
}

function loadZoneThresholds(): ZoneThresholdsConfig {
  return parseConfig(zoneThresholdsSchema, zoneThresholdsJson, "zone-thresholds.json");
}

function loadVulnerabilityWeights(): VulnerabilityWeightsConfig {
  const config = parseConfig(
    vulnerabilityWeightsSchema,
    vulnerabilityWeightsJson,
    "vulnerability-weights.json",
  );

  assertSumsToOne(
    {
      demographic: config.dimensions.demographic.weight,
      socioeconomic: config.dimensions.socioeconomic.weight,
      structural: config.dimensions.structural.weight,
      accessibility: config.dimensions.accessibility.weight,
    },
    "vulnerability-weights.json dimensions.*.weight",
  );

  for (const [name, dimension] of Object.entries(config.dimensions)) {
    assertSumsToOne(
      dimension.indicators,
      `vulnerability-weights.json dimensions.${name}.indicators`,
    );
  }

  assertSumsToOne(
    config.copingCapacity.indicators,
    "vulnerability-weights.json copingCapacity.indicators",
  );

  return config;
}

function loadPriorityWeights(): PriorityWeightsConfig {
  const config = parseConfig(priorityWeightsSchema, priorityWeightsJson, "priority-weights.json");
  assertSumsToOne(config.weights, "priority-weights.json weights");
  return config;
}

function loadSuitabilityAhp(): SuitabilityAhpConfig {
  const config = parseConfig(suitabilityAhpSchema, suitabilityAhpJson, "suitability-ahp.json");
  assertSumsToOne(config.weights, "suitability-ahp.json weights");
  if (config.consistencyRatio >= 0.1) {
    throw new Error(
      `[shared/config] suitability-ahp.json consistencyRatio (${config.consistencyRatio}) must be < 0.10`,
    );
  }
  return config;
}

function loadCapacityNorms(): CapacityNormsConfig {
  return parseConfig(capacityNormsSchema, capacityNormsJson, "capacity-norms.json");
}

function loadExclusionCriteria(): ExclusionCriteriaConfig {
  return parseConfig(exclusionCriteriaSchema, exclusionCriteriaJson, "exclusion-criteria.json");
}

function loadFactorReclassification(): FactorReclassificationConfig {
  const config = parseConfig(
    factorReclassificationSchema,
    factorReclassificationJson,
    "factor-reclassification.json",
  );
  for (const [hazard, hazardConfig] of Object.entries(hazardWeights.hazards)) {
    const reclassHazard = config.hazards[hazard];
    if (!reclassHazard) {
      throw new Error(
        `[shared/config] factor-reclassification.json is missing hazard "${hazard}" present in hazard-weights.json`,
      );
    }
    const weightFactors = Object.keys(hazardConfig.factors).sort();
    const reclassFactors = Object.keys(reclassHazard).sort();
    if (weightFactors.join(",") !== reclassFactors.join(",")) {
      throw new Error(
        `[shared/config] factor-reclassification.json hazards.${hazard} factor keys [${reclassFactors.join(", ")}] do not match hazard-weights.json hazards.${hazard}.factors keys [${weightFactors.join(", ")}]`,
      );
    }
    for (const [factorName, entry] of Object.entries(reclassHazard)) {
      const maxValues = entry.breakpoints.map((b) => b.max);
      for (let i = 0; i < maxValues.length - 1; i += 1) {
        const current = maxValues[i] ?? null;
        const next = maxValues[i + 1] ?? null;
        if (current === null) {
          throw new Error(
            `[shared/config] factor-reclassification.json hazards.${hazard}.${factorName}: only the last breakpoint may have max: null`,
          );
        }
        if (next !== null && next <= current) {
          throw new Error(
            `[shared/config] factor-reclassification.json hazards.${hazard}.${factorName}: breakpoints must have strictly ascending max values`,
          );
        }
      }
      if (maxValues[maxValues.length - 1] !== null) {
        throw new Error(
          `[shared/config] factor-reclassification.json hazards.${hazard}.${factorName}: the last breakpoint must have max: null`,
        );
      }
      const ratings = entry.breakpoints.map((b) => b.rating);
      if (ratings.join(",") !== "1,2,3,4,5") {
        throw new Error(
          `[shared/config] factor-reclassification.json hazards.${hazard}.${factorName}: breakpoint ratings must be exactly [1,2,3,4,5] in order`,
        );
      }
    }
  }
  return config;
}

function loadBlendConfig(): BlendConfig {
  return parseConfig(blendConfigSchema, blendConfigJson, "blend-config.json");
}

function loadPermissions(): PermissionsConfig {
  const config = parseConfig(permissionsConfigSchema, permissionsJson, "permissions.json");

  const knownPermissions = new Set(config.permissions);
  for (const [role, granted] of Object.entries(config.roles)) {
    for (const permission of granted) {
      if (!knownPermissions.has(permission)) {
        throw new Error(
          `[shared/config] permissions.json roles.${role} grants unknown permission "${permission}" (not in the top-level permissions list)`,
        );
      }
    }
  }

  const approverPermission = "recommendation:approve";
  const approverRoles = new Set<string>(config.separationOfDuties.approverRoles);
  for (const [role, granted] of Object.entries(config.roles)) {
    const hasApprove = granted.includes(approverPermission);
    const shouldHaveApprove = approverRoles.has(role);
    if (hasApprove !== shouldHaveApprove) {
      throw new Error(
        `[shared/config] permissions.json separation-of-duties violation: "${approverPermission}" must be granted to exactly [${config.separationOfDuties.approverRoles.join(", ")}] (role "${role}" ${hasApprove ? "has" : "lacks"} it, expected ${shouldHaveApprove ? "to have" : "not to have"} it)`,
      );
    }
  }

  return config;
}

/** Validated at module-load time; importing this module throws if any config file is invalid. */
export const hazardWeights: HazardWeightsConfig = loadHazardWeights();
export const zoneThresholds: ZoneThresholdsConfig = loadZoneThresholds();
export const vulnerabilityWeights: VulnerabilityWeightsConfig = loadVulnerabilityWeights();
export const priorityWeights: PriorityWeightsConfig = loadPriorityWeights();
export const suitabilityAhp: SuitabilityAhpConfig = loadSuitabilityAhp();
export const capacityNorms: CapacityNormsConfig = loadCapacityNorms();
export const exclusionCriteria: ExclusionCriteriaConfig = loadExclusionCriteria();
export const factorReclassification: FactorReclassificationConfig = loadFactorReclassification();
export const blendConfig: BlendConfig = loadBlendConfig();
export const permissionsConfig: PermissionsConfig = loadPermissions();
