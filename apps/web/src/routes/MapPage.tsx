import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { HazardType, RecommendationStatus } from "@punarvas/shared";
import { useDistrictStore } from "../stores/districtStore";
import { useScenarioStore } from "../stores/scenarioStore";
import {
  useDistricts,
  useZones,
  useHabitationsGeoJSON,
  useRelocationSites,
  useRecommendations,
  useScenarios,
} from "../hooks/useApi";
import { MapView } from "../components/map/MapView";
import { LayerPanel } from "../components/map/LayerPanel";
import { ZoneLegend } from "../components/map/ZoneLegend";
import { HabitationDetailPanel } from "../components/map/HabitationDetailPanel";
import { ScenarioPanel } from "../components/scenario/ScenarioPanel";
import { ScenarioSummary } from "../components/scenario/ScenarioSummary";
import { ScenarioModeBanner } from "../components/scenario/ScenarioModeBanner";

export function MapPage(): JSX.Element {
  const selectedDistrictId = useDistrictStore((s) => s.selectedDistrictId);
  const { data: districtsData, isLoading: districtsLoading, isError: districtsError } = useDistricts();
  const district = districtsData?.items.find((d) => d._id === selectedDistrictId);

  const { data: zonesData } = useZones(selectedDistrictId ?? undefined);
  const { data: habitationsData } = useHabitationsGeoJSON(selectedDistrictId ?? undefined);
  const { data: sitesData } = useRelocationSites(selectedDistrictId ?? "");
  const { data: recommendationsData } = useRecommendations({ districtId: selectedDistrictId ?? undefined });
  const { data: scenariosData } = useScenarios(selectedDistrictId ?? undefined);
  const activeScenarioId = useScenarioStore((s) => s.activeScenarioId);
  const scenarioViewMode = useScenarioStore((s) => s.viewMode);
  const setActiveScenario = useScenarioStore((s) => s.setActiveScenario);
  const activeScenario = scenariosData?.items.find((s) => s._id === activeScenarioId) ?? null;

  const recommendationStatusByHabitationId = useMemo(() => {
    const map: Record<string, RecommendationStatus> = {};
    for (const rec of recommendationsData?.items ?? []) {
      if (rec.status !== "PENDING_REVIEW") {
        map[rec.habitationId._id] = rec.status;
      }
    }
    return map;
  }, [recommendationsData]);

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

  // A scenario belongs to one district — leaving scenario mode behind
  // when the officer switches districts avoids showing another
  // district's what-if zones under the wrong boundary.
  useEffect(() => {
    setActiveScenario(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDistrictId]);

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

  if (districtsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-mist-300">Loading districts…</p>
      </div>
    );
  }

  if (districtsError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zone-red">Could not load districts. Try reloading the page.</p>
      </div>
    );
  }

  if (!districtsData || districtsData.items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-md text-center text-sm text-mist-300">
          No district is in your assigned scope yet. Contact your administrator to be assigned to a district.
        </p>
      </div>
    );
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
        recommendationStatusByHabitationId={recommendationStatusByHabitationId}
        activeScenario={activeScenario}
        scenarioViewMode={scenarioViewMode}
      />

      {activeScenario && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 w-[36rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2">
          <ScenarioModeBanner scenarioName={activeScenario.name} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 flex justify-between p-3">
        <div className="scrollbar-thin pointer-events-auto flex max-h-full flex-col gap-3 overflow-y-auto">
          <LayerPanel
            availableHazards={availableHazards}
            visibleHazards={visibleHazards}
            onToggleHazard={toggleHazard}
            showHabitations={showHabitations}
            onToggleHabitations={() => setShowHabitations((v) => !v)}
            showSites={showSites}
            onToggleSites={() => setShowSites((v) => !v)}
          />
          <ZoneLegend showDecisionRing={Object.keys(recommendationStatusByHabitationId).length > 0} />
          {selectedDistrictId && <ScenarioPanel districtId={selectedDistrictId} />}
          {activeScenario && (
            <div className="w-72 rounded border border-ink-600 bg-ink-800/95 p-3 shadow-panel backdrop-blur-sm">
              <ScenarioSummary scenario={activeScenario} />
            </div>
          )}
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
