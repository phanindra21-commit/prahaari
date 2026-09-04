import { useQuery } from "@tanstack/react-query";
import type { RelocationPriorityBucket, ZoneClass } from "@punarvas/shared";
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

export function useRelocationSites(districtId: string | undefined) {
  return useQuery({
    queryKey: ["relocation-sites", districtId],
    queryFn: () => api.listRelocationSites(districtId!),
    enabled: !!districtId,
  });
}
