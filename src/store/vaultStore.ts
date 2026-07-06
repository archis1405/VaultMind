import { create } from "zustand";

/**
 * Top-level app state. Placeholder for Step 1 — just enough to prove Zustand
 * is wired up. Real slices (vault files, index status, chat) arrive in later
 * steps, likely split into multiple stores or slices as they grow.
 */
export type AppStatus = "idle" | "ingesting" | "indexing" | "ready" | "error";

interface VaultState {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  status: "idle",
  setStatus: (status) => set({ status }),
}));
