import { create } from "zustand";

interface DistrictState {
  selectedDistrictId: string | null;
  setSelectedDistrictId: (id: string) => void;
  clearSelectedDistrictId: () => void;
}

export const useDistrictStore = create<DistrictState>((set) => ({
  selectedDistrictId: null,
  setSelectedDistrictId: (id) => set({ selectedDistrictId: id }),
  clearSelectedDistrictId: () => set({ selectedDistrictId: null }),
}));
