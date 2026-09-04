import type {
  HazardType,
  ZoneClass,
  RelocationPriorityBucket,
  ExplanationDirection,
  GeoPoint,
  GeoPolygonal,
  UserRole,
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
  simplifiedGeometry: GeoPolygonal;
  hazardScore: number;
  cellCount: number;
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

export type { UserRole };
