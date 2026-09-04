import type {
  HazardType,
  ZoneClass,
  RelocationPriorityBucket,
  ExplanationDirection,
  GeoPoint,
  GeoPolygonal,
  UserRole,
  RecommendationStatus,
  DecisionAction,
} from "@punarvas/shared";
import { apiRequest } from "./apiClient";

export interface District {
  _id: string;
  lgdCode: string;
  name: string;
  state: string;
  boundary: GeoPolygonal;
  population: number;
  areaSqKm: number;
  primaryHazards: HazardType[];
  dmAuthorityContact: { name: string; designation: string; phone: string; email?: string };
}

export function listDistricts(): Promise<{ items: District[] }> {
  return apiRequest("/districts");
}

export interface ZonePolygon {
  _id: string;
  districtId: string;
  hazardType: HazardType;
  zoneClass: ZoneClass;
  geometry: GeoPolygonal;
  /** Absent for a hand-drawn seed-authored zone (data/seed/*-hazard-zones.geojson)
   * — every ML-generated zone (the live pipeline's output) always sets it. */
  simplifiedGeometry?: GeoPolygonal;
  hazardScore: number;
  modelVersion: string;
  validFrom: string;
  validTo: string | null;
  dataProvenance: string;
}

export function listZones(districtId: string, hazardType?: HazardType): Promise<{ items: ZonePolygon[] }> {
  return apiRequest("/zones", { query: { districtId, hazardType } });
}

export interface AssessmentSummary {
  overallZoneClass: ZoneClass;
  compositeRiskScore: number;
  vulnerabilityIndex: number;
  relocationPriorityIndex: number | null;
  priorityBucket: RelocationPriorityBucket | null;
  computedAt: string;
}

export interface HabitationSummary {
  id: string;
  lgdHabitationCode: string;
  name: string;
  block: string;
  panchayat: string;
  districtId: string;
  centroid: GeoPoint;
  population: number;
  households: number;
  consentStatus: string;
  assessment: AssessmentSummary | null;
}

export interface HabitationListResponse {
  items: HabitationSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function listHabitations(params: {
  districtId?: string;
  bucket?: RelocationPriorityBucket;
  zoneClass?: ZoneClass;
  page?: number;
  pageSize?: number;
}): Promise<HabitationListResponse> {
  return apiRequest("/habitations", { query: params });
}

export interface HabitationFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: GeoPoint;
    properties: Omit<HabitationSummary, "centroid">;
  }>;
}

export function listHabitationsGeoJSON(params: {
  districtId?: string;
  bucket?: RelocationPriorityBucket;
  zoneClass?: ZoneClass;
  pageSize?: number;
}): Promise<HabitationFeatureCollection> {
  return apiRequest("/habitations", { query: { ...params, format: "geojson" } });
}

export interface HazardExposureEntry {
  hazardType: HazardType;
  hazardScore: number;
  exposure: number;
  zoneClass: ZoneClass;
  disasterHistoryBoost: number;
}

export interface VulnerabilityDimensions {
  demographic: number;
  socioeconomic: number;
  structural: number;
  accessibility: number;
}

export interface ExplanationEntry {
  factor: string;
  contribution: number;
  direction: ExplanationDirection;
  label?: string;
}

/**
 * Set only when a configured (trigger, mechanism) pair — e.g. cloudburst
 * triggering landslide — is independently Red/Orange for BOTH hazards at
 * this habitation. When set, `governingHazard` on the assessment is the
 * MECHANISM (the consequence that actually damages habitations), not
 * simply whichever raw score is numerically larger.
 */
export interface CompoundHazard {
  trigger: HazardType;
  mechanism: HazardType;
  triggerRisk: number;
  mechanismRisk: number;
  compoundRisk: number;
}

export interface AssessmentDetail {
  id: string;
  habitationId: string;
  districtId: string;
  hazardExposure: HazardExposureEntry[];
  vulnerabilityIndex: number;
  vulnerabilityDimensions: VulnerabilityDimensions;
  copingCapacity: number;
  compositeRiskScore: number;
  governingHazard: HazardType;
  overallZoneClass: ZoneClass;
  relocationPriorityIndex: number | null;
  priorityBucket: RelocationPriorityBucket | null;
  modelVersion: string;
  computedAt: string;
  validFrom: string;
  validTo: string | null;
  explanation: ExplanationEntry[];
  compoundHazard: CompoundHazard | null;
}

export interface HabitationDetail extends Omit<HabitationSummary, "assessment"> {
  boundary?: GeoPolygonal;
  demographics: Record<string, number>;
  structures: Record<string, unknown>;
  access: Record<string, unknown>;
  livelihood: Record<string, unknown>;
  copingCapacity: Record<string, unknown>;
  dataProvenance: string;
  latestAssessment: AssessmentDetail | null;
}

export function getHabitation(id: string): Promise<HabitationDetail> {
  return apiRequest(`/habitations/${id}`);
}

export function getHabitationAssessment(id: string, at?: string): Promise<AssessmentDetail> {
  return apiRequest(`/habitations/${id}/assessment`, { query: { at } });
}

export interface ExplainResponse {
  habitationId: string;
  habitationName: string;
  governingHazard: HazardType;
  overallZoneClass: ZoneClass;
  relocationPriorityIndex: number | null;
  priorityBucket: RelocationPriorityBucket | null;
  hazardExposure: HazardExposureEntry[];
  explanation: ExplanationEntry[];
  compoundHazard: CompoundHazard | null;
  summary: string;
}

export function getHabitationExplain(id: string): Promise<ExplainResponse> {
  return apiRequest(`/habitations/${id}/explain`);
}

export interface PriorityItem {
  habitationId: string;
  habitationName: string;
  districtId: string;
  overallZoneClass: ZoneClass;
  governingHazard: HazardType;
  vulnerabilityIndex: number;
  compositeRiskScore: number;
  relocationPriorityIndex: number;
  priorityBucket: RelocationPriorityBucket;
  topFactor: ExplanationEntry | null;
  compoundHazard: CompoundHazard | null;
  computedAt: string;
}

export interface PrioritiesResponse {
  items: PriorityItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function listPriorities(params: {
  districtId?: string;
  bucket?: RelocationPriorityBucket;
  page?: number;
  pageSize?: number;
}): Promise<PrioritiesResponse> {
  return apiRequest("/priorities", { query: params });
}

export interface RunPipelineResponse {
  jobId: string;
  status: string;
  hazardTypes: HazardType[];
}

export function runPipeline(districtId: string, hazardTypes?: HazardType[]): Promise<RunPipelineResponse> {
  return apiRequest("/pipeline/run", { method: "POST", body: { districtId, hazardTypes } });
}

export interface JobStatus {
  _id: string;
  type: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progressPercent: number;
  result?: unknown;
  error?: string;
}

export function getJobStatus(jobId: string): Promise<JobStatus> {
  return apiRequest(`/zoning/runs/${jobId}`);
}

export interface HazardEventRecord {
  _id: string;
  districtId: string;
  hazardType: HazardType;
  name: string;
  date: string;
  extent: GeoPoint | GeoPolygonal;
  deaths: number;
  injured: number;
  displaced: number;
  housesDamaged: number;
  economicLossInrLakh: number;
  source: string;
  confidence: string;
  dataProvenance: string;
  sourceUrl?: string;
}

export function listHazardEvents(params: {
  districtId?: string;
  hazardType?: HazardType;
}): Promise<{ items: HazardEventRecord[] }> {
  return apiRequest("/hazard-events", { query: params });
}

export interface RelocationSite {
  _id: string;
  districtId: string;
  name: string;
  geometry: GeoPolygonal;
  centroid: GeoPoint;
  areaSqm: number;
  landOwnership: string;
  exclusionsPassed: string[];
  exclusionsFailed: string[];
  overallSuitabilityScore: number | null;
  dataProvenance: string;
}

export function listRelocationSites(districtId: string): Promise<{ items: RelocationSite[] }> {
  return apiRequest("/relocation-sites", { query: { districtId } });
}

// --- Step 7 Commit 2/3: scored relocation sites, recommendations, decisions ---

export type BindingConstraint = "LAND" | "WATER" | "EDUCATION" | "HEALTH" | "ACCESS";

export interface CarryingCapacity {
  byLand: number;
  byWater: number;
  byEducation: number;
  byHealth: number;
  byAccess: number;
  effectiveCapacity: number;
  bindingConstraint: BindingConstraint;
}

export interface RelocationSiteRawAttributes {
  slopeDegrees: number;
  inCrzI: boolean;
  inProtectedForest: boolean;
  inFloodplain100yr: boolean;
  distanceToActiveFaultM: number;
  distanceToWaterBodyM: number;
  inMiningLease: boolean;
  distanceToAllWeatherRoadM: number;
  availableWaterSupplyLpd: number;
  nearbySchoolSpareCapacitySeats: number;
  nearbyHealthFacilitySpareCapacityPopulation: number;
  existingInfrastructureIndex: number;
}

/** Full scoring detail for a candidate relocation site — GET /sites, /sites/:id
 * (METHODOLOGY §4/§5), distinct from the lighter `RelocationSite` above (which
 * backs the district-wide map's raw site markers). `overallSuitabilityScore`
 * and `carryingCapacity` are null for a site that failed an exclusion. */
export interface RelocationSiteDetail {
  _id: string;
  districtId: string;
  name: string;
  geometry: GeoPolygonal;
  centroid: GeoPoint;
  areaSqm: number;
  landOwnership: string;
  rawAttributes: RelocationSiteRawAttributes;
  exclusionsPassed: string[];
  exclusionsFailed: string[];
  suitabilitySubScores: Record<string, number>;
  overallSuitabilityScore: number | null;
  carryingCapacity: CarryingCapacity | null;
  scoredAt: string | null;
  modelVersion: string | null;
  dataProvenance: string;
}

export function listSites(districtId: string, excluded?: boolean): Promise<{ items: RelocationSiteDetail[] }> {
  return apiRequest("/sites", { query: { districtId, excluded: excluded === undefined ? undefined : String(excluded) } });
}

export function getSite(id: string): Promise<RelocationSiteDetail> {
  return apiRequest(`/sites/${id}`);
}

/** The habitation as embedded (Mongoose `.populate()`, not the /habitations
 * route's own hand-shaped response) in a Recommendation — raw field names
 * (`_id`, not `id`), a subset typed here to what the workbench UI reads. */
export interface RecommendationHabitationRef {
  _id: string;
  name: string;
  panchayat: string;
  block: string;
  districtId: string;
  centroid: GeoPoint;
  population: number;
  households: number;
}

export interface PhasingPlanEntry {
  phase: number;
  householdCount: number;
  targetDate: string;
}

export interface RankedCandidateSiteDetail {
  relocationSiteId: RelocationSiteDetail;
  rank: number;
  suitabilityScore: number;
}

export interface RecommendationItem {
  _id: string;
  habitationId: RecommendationHabitationRef;
  districtId: string;
  candidateSites: RankedCandidateSiteDetail[];
  selectedSiteId: RelocationSiteDetail | null;
  priorityBucket: RelocationPriorityBucket;
  estimatedHouseholdsToMove: number;
  phasing: PhasingPlanEntry[];
  rationale: string;
  modelVersion: string;
  status: RecommendationStatus;
  generatedAt: string;
}

export function listRecommendations(params: {
  districtId?: string;
  priorityBucket?: RelocationPriorityBucket;
  status?: RecommendationStatus;
}): Promise<{ items: RecommendationItem[] }> {
  return apiRequest("/recommendations", { query: params });
}

export function getRecommendation(id: string): Promise<RecommendationItem> {
  return apiRequest(`/recommendations/${id}`);
}

export interface OverriddenFieldRecord {
  field: string;
  fromValue: unknown;
  toValue: unknown;
}

export interface DecisionOfficerRef {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface DecisionRecord {
  _id: string;
  recommendationId: string;
  districtId: string;
  officerId: DecisionOfficerRef;
  action: DecisionAction;
  justification: string;
  overriddenFields: OverriddenFieldRecord[];
  decidedAt: string;
  ipAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntryRecord {
  _id: string;
  seq: number;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  severity: string;
  timestamp: string;
  prevHash: string;
  entryHash: string;
}

export interface ChainVerification {
  valid: boolean;
  entriesChecked: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

export interface AuditTrailResponse {
  decisions: DecisionRecord[];
  auditEntries: AuditEntryRecord[];
  chainVerification: ChainVerification;
}

export function getRecommendationAuditTrail(id: string): Promise<AuditTrailResponse> {
  return apiRequest(`/recommendations/${id}/audit-trail`);
}

export interface CreateDecisionOverride {
  field: "selectedSiteId" | "estimatedHouseholdsToMove" | "phasing";
  fromValue: unknown;
  toValue: unknown;
}

export interface CreateDecisionRequest {
  recommendationId: string;
  action: DecisionAction;
  justification: string;
  overriddenFields?: CreateDecisionOverride[];
}

/** POST /decisions returns the just-created Decision unpopulated (`officerId`
 * is a bare id string) — only GET /decisions and the audit-trail route
 * populate it to a DecisionOfficerRef. */
export interface CreateDecisionResponse {
  decision: Omit<DecisionRecord, "officerId"> & { officerId: string };
  recommendation: RecommendationItem;
}

export function createDecision(body: CreateDecisionRequest): Promise<CreateDecisionResponse> {
  return apiRequest("/decisions", { method: "POST", body });
}

export function listDecisions(recommendationId?: string): Promise<{ items: DecisionRecord[] }> {
  return apiRequest("/decisions", { query: { recommendationId } });
}

export type { UserRole };
