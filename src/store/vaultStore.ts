import { create } from "zustand";
import {
  ingestVault,
  pickVaultDirectory,
  VaultPickCancelled,
} from "../lib/vault/ingest";
import type { IngestProgress, VaultNote } from "../lib/vault/types";

/**
 * Top-level app status. As of Step 2 only `idle`/`ingesting`/`ready`/`error`
 * are reachable; `indexing` lands with the embedding pipeline (Step 4+).
 */
export type AppStatus = "idle" | "ingesting" | "indexing" | "ready" | "error";

interface VaultState {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;

  /** Human-readable name of the chosen vault directory. */
  vaultName?: string;
  /** All parsed notes, sorted by path. */
  notes: VaultNote[];
  /** Live ingest progress, present while status === "ingesting". */
  progress?: IngestProgress;
  /** Last error message, if the previous action failed. */
  error?: string;
  /** Path of the note currently selected for preview in the UI. */
  selectedNotePath?: string;

  /** Open the picker and ingest the chosen vault into state. */
  loadVault: () => Promise<void>;
  /** Select a note for preview (or clear with undefined). */
  selectNote: (path?: string) => void;
  /** Clear the loaded vault, back to a fresh idle state. */
  resetVault: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  status: "idle",
  notes: [],

  setStatus: (status) => set({ status }),
  selectNote: (path) => set({ selectedNotePath: path }),

  loadVault: async () => {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickVaultDirectory();
    } catch (err) {
      // User dismissed the picker — leave existing state untouched.
      if (err instanceof VaultPickCancelled) return;
      set({ status: "error", error: (err as Error).message });
      return;
    }

    set({
      status: "ingesting",
      vaultName: dir.name,
      notes: [],
      error: undefined,
      selectedNotePath: undefined,
      progress: { filesFound: 0, filesRead: 0 },
    });

    try {
      const notes = await ingestVault(dir, (progress) => set({ progress }));
      set({ status: "ready", notes, progress: undefined });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, progress: undefined });
    }
  },

  resetVault: () =>
    set({
      status: "idle",
      notes: [],
      vaultName: undefined,
      progress: undefined,
      error: undefined,
      selectedNotePath: undefined,
    }),
}));
