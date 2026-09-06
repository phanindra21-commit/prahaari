import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecommendationStatus, RelocationPriorityBucket, ZoneClass } from "@punarvas/shared";
import * as api from "../lib/api";

export function useDistricts() {
  return useQuery({ queryKey: ["districts"], queryFn: api.listDistricts });
}

export function useZones(districtId: string | undefined) {
  return useQuery({
    queryKey: ["zones", districtId],
    queryFn: () => api.listZones(districtId!),
    enabled: !!districtId,
  });
}

export function useHabitationsGeoJSON(
  districtId: string | undefined,
  filters: { bucket?: RelocationPriorityBucket; zoneClass?: ZoneClass } = {},
) {
  return useQuery({
    queryKey: ["habitations-geojson", districtId, filters],
    queryFn: () => api.listHabitationsGeoJSON({ districtId, pageSize: 200, ...filters }),
    enabled: !!districtId,
  });
}

export function useHabitations(districtId: string | undefined) {
  return useQuery({
    queryKey: ["habitations", districtId],
    queryFn: () => api.listHabitations({ districtId, pageSize: 200 }),
    enabled: !!districtId,
  });
}

export function useHabitation(id: string | undefined) {
  return useQuery({
    queryKey: ["habitation", id],
    queryFn: () => api.getHabitation(id!),
    enabled: !!id,
  });
}

export function useHabitationExplain(id: string | undefined) {
  return useQuery({
    queryKey: ["habitation-explain", id],
    queryFn: () => api.getHabitationExplain(id!),
    enabled: !!id,
  });
}

export function usePriorities(districtId: string | undefined, bucket?: RelocationPriorityBucket) {
  return useQuery({
    queryKey: ["priorities", districtId, bucket],
    queryFn: () => api.listPriorities({ districtId, bucket, pageSize: 100 }),
    enabled: !!districtId,
  });
}

export function useHazardEvents(districtId: string | undefined) {
  return useQuery({
    queryKey: ["hazard-events", districtId],
    queryFn: () => api.listHazardEvents({ districtId }),
    enabled: !!districtId,
  });
}

export function useFieldReports(districtId: string | undefined) {
  return useQuery({
    queryKey: ["field-reports", districtId],
    queryFn: () => api.listFieldReports({ districtId }),
    enabled: !!districtId,
  });
}

export function useRelocationSites(districtId: string | undefined) {
  return useQuery({
    queryKey: ["relocation-sites", districtId],
    queryFn: () => api.listRelocationSites(districtId!),
    enabled: !!districtId,
  });
}

export function useSites(districtId: string | undefined, excluded?: boolean) {
  return useQuery({
    queryKey: ["sites", districtId, excluded],
    queryFn: () => api.listSites(districtId!, excluded),
    enabled: !!districtId,
  });
}

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ["site", id],
    queryFn: () => api.getSite(id!),
    enabled: !!id,
  });
}

export function useRecommendations(params: {
  districtId?: string;
  priorityBucket?: RelocationPriorityBucket;
  status?: RecommendationStatus;
}) {
  return useQuery({
    queryKey: ["recommendations", params],
    queryFn: () => api.listRecommendations(params),
    enabled: !!params.districtId,
  });
}

export function useRecommendation(id: string | undefined) {
  return useQuery({
    queryKey: ["recommendation", id],
    queryFn: () => api.getRecommendation(id!),
    enabled: !!id,
  });
}

export function useRecommendationAuditTrail(id: string | undefined) {
  return useQuery({
    queryKey: ["recommendation-audit-trail", id],
    queryFn: () => api.getRecommendationAuditTrail(id!),
    enabled: !!id,
  });
}

/** Submits a decision (approve/modify/reject/defer) and invalidates every
 * query whose data the decision changes: the queue list, this
 * recommendation's own detail + audit trail, and (Commit 3F) the map's
 * habitation layer, which reads recommendation status to ring decided
 * habitations. */
export function useCreateDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createDecision,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendation", data.recommendation._id] });
      void queryClient.invalidateQueries({ queryKey: ["recommendation-audit-trail", data.recommendation._id] });
    },
  });
}

export function useDecisions(recommendationId: string | undefined) {
  return useQuery({
    queryKey: ["decisions", recommendationId],
    queryFn: () => api.listDecisions({ recommendationId }),
    enabled: !!recommendationId,
  });
}

export function useDistrictDecisions(districtId: string | undefined) {
  return useQuery({
    queryKey: ["decisions", "district", districtId],
    queryFn: () => api.listDecisions({ districtId }),
    enabled: !!districtId,
  });
}

export function useScenarios(districtId: string | undefined) {
  return useQuery({
    queryKey: ["scenarios", districtId],
    queryFn: () => api.listScenarios(districtId),
    enabled: !!districtId,
  });
}

export function useRunScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.runScenario,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["scenarios", data.districtId] });
    },
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteScenario,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
    },
  });
}

export function useDashboardSummary(districtId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard-summary", districtId],
    queryFn: () => api.getDashboardSummary(districtId),
  });
}

/** Polls every 30s — simple, in-app only (Step 10 Part 6): no push/email/
 * websocket, a bell icon that stays reasonably fresh is enough for this demo. */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications(),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
