import { useVaultStore } from "../store/vaultStore";
import { isFileSystemAccessSupported } from "../lib/vault/ingest";

/**
 * Entry point for loading a vault: the "Open vault" button plus live ingest
 * progress and error/unsupported-browser messaging.
 */
export function VaultPicker() {
  const status = useVaultStore((s) => s.status);
  const progress = useVaultStore((s) => s.progress);
  const error = useVaultStore((s) => s.error);
  const vaultName = useVaultStore((s) => s.vaultName);
  const loadVault = useVaultStore((s) => s.loadVault);

  const supported = isFileSystemAccessSupported();
  const busy = status === "ingesting";

  if (!supported) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        Your browser doesn't support the File System Access API. Open Memora in
        a Chromium-based browser (Chrome, Edge, Arc, Brave) to load a vault.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void loadVault()}
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? "Reading vault…" : vaultName ? "Change vault" : "Open vault folder"}
      </button>

      {busy && progress && (
        <p className="text-xs text-neutral-500">
          {progress.filesRead > 0
            ? `Read ${progress.filesRead} / ${progress.filesFound} notes`
            : `Found ${progress.filesFound} notes…`}
          {progress.current && (
            <span className="block truncate text-neutral-400">{progress.current}</span>
          )}
        </p>
      )}

      {status === "error" && error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
