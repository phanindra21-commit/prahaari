import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { HazardType } from "@punarvas/shared";
import { useDistrictStore } from "../stores/districtStore";
import { useDistricts, useZones, useHabitationsGeoJSON, useRelocationSites } from "../hooks/useApi";
import { MapView } from "../components/map/MapView";
import { LayerPanel } from "../components/map/LayerPanel";
import { ZoneLegend } from "../components/map/ZoneLegend";
import { HabitationDetailPanel } from "../components/map/HabitationDetailPanel";

export function MapPage(): JSX.Element {
  const selectedDistrictId = useDistrictStore((s) => s.selectedDistrictId);
  const { data: districtsData } = useDistricts();
  const district = districtsData?.items.find((d) => d._id === selectedDistrictId);

  const { data: zonesData } = useZones(selectedDistrictId ?? undefined);
  const { data: habitationsData } = useHabitationsGeoJSON(selectedDistrictId ?? undefined);
  const { data: sitesData } = useRelocationSites(selectedDistrictId ?? "");

  const availableHazards = useMemo(() => district?.primaryHazards ?? [], [district]);
  const [visibleHazards, setVisibleHazards] = useState<Set<HazardType>>(new Set());
  const [showHabitations, setShowHabitations] = useState(true);
  const [showSites, setShowSites] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedHabitationId, setSelectedHabitationId] = useState<string | null>(
    searchParams.get("habitation"),
  );

  useEffect(() => {
    setVisibleHazards(new Set(availableHazards));
  }, [availableHazards]);

  function selectHabitation(id: string | null): void {
    setSelectedHabitationId(id);
    setSearchParams(id ? { habitation: id } : {}, { replace: true });
  }

  function toggleHazard(hazard: HazardType): void {
    setVisibleHazards((prev) => {
      const next = new Set(prev);
      if (next.has(hazard)) next.delete(hazard);
      else next.add(hazard);
      return next;
    });
  }

  return (
    <div className="relative h-full w-full">
      <MapView
        district={district}
        zones={zonesData?.items ?? []}
        visibleHazards={visibleHazards}
        habitations={habitationsData}
        showHabitations={showHabitations}
        relocationSites={sitesData?.items ?? []}
        showSites={showSites}
        selectedHabitationId={selectedHabitationId}
        onHabitationClick={selectHabitation}
      />

      <div className="pointer-events-none absolute inset-0 flex justify-between p-3">
        <div className="pointer-events-auto flex flex-col gap-3">
          <LayerPanel
            availableHazards={availableHazards}
            visibleHazards={visibleHazards}
            onToggleHazard={toggleHazard}
            showHabitations={showHabitations}
            onToggleHabitations={() => setShowHabitations((v) => !v)}
            showSites={showSites}
            onToggleSites={() => setShowSites((v) => !v)}
          />
          <ZoneLegend />
        </div>

        {selectedHabitationId && (
          <div className="pointer-events-auto">
            <HabitationDetailPanel
              habitationId={selectedHabitationId}
              onClose={() => selectHabitation(null)}
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-ink-600 bg-ink-800/95 px-2.5 py-1 font-mono text-[11px] text-mist-300 shadow-panel backdrop-blur-sm">
        SYNTHETIC_DEMO — all hazard, vulnerability, and priority data on this map is synthetic
      </div>
    </div>
  );
}
