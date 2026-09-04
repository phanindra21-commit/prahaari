import { create } from "zustand";

/** Which of the two states the map currently renders for the active
 * scenario's zone geometry — "baseline" is the unperturbed real state,
 * "scenario" is the perturbed what-if state. Independent of whether
 * scenario mode is active at all (activeScenarioId === null means the
 * map ignores this and renders the live hazard zones as normal). */
export type ScenarioViewMode = "baseline" | "scenario";

interface ScenarioState {
  activeScenarioId: string | null;
  viewMode: ScenarioViewMode;
  setActiveScenario: (id: string | null) => void;
  setViewMode: (mode: ScenarioViewMode) => void;
  toggleViewMode: () => void;
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  activeScenarioId: null,
  viewMode: "scenario",
  setActiveScenario: (id) => set({ activeScenarioId: id, viewMode: "scenario" }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === "baseline" ? "scenario" : "baseline" })),
}));
