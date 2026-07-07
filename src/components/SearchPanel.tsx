import { useVaultStore } from "../store/vaultStore";
import type { HybridResult } from "../lib/retrieval/search";

/** A short, single-line-ish preview of a chunk's text. */
function snippet(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function RankBadge({ label, rank }: { label: string; rank?: number }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        rank === undefined
          ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600"
          : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      }`}
      title={rank === undefined ? `not in ${label} top results` : `${label} rank ${rank}`}
    >
      {label} {rank === undefined ? "—" : `#${rank}`}
    </span>
  );
}

function ResultRow({ result }: { result: HybridResult }) {
  const selectNote = useVaultStore((s) => s.selectNote);
  const clearSearch = useVaultStore((s) => s.clearSearch);
  const { chunk } = result;
  const noteName = chunk.notePath.split("/").pop()?.replace(/\.md$/i, "") ?? chunk.notePath;

  return (
    <button
      type="button"
      onClick={() => {
        selectNote(chunk.notePath);
        clearSearch();
      }}
      className="w-full rounded-lg border border-neutral-200 p-3 text-left transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {noteName}
          {chunk.headingPath.length > 0 && (
            <span className="font-normal text-neutral-400"> › {chunk.headingPath.join(" › ")}</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-neutral-400">
          rrf {result.score.toFixed(4)}
        </span>
      </div>
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">{snippet(chunk.text)}</p>
      <div className="flex gap-1">
        <RankBadge label="bm25" rank={result.bm25Rank} />
        <RankBadge label="vector" rank={result.vectorRank} />
      </div>
    </button>
  );
}

/** Search box + hybrid results. The demonstration surface for Step 6. */
export function SearchPanel() {
  const query = useVaultStore((s) => s.query);
  const setQuery = useVaultStore((s) => s.setQuery);
  const search = useVaultStore((s) => s.search);
  const searching = useVaultStore((s) => s.searching);
  const results = useVaultStore((s) => s.searchResults);
  const hasIndex = useVaultStore((s) => s.embeddedChunks.length > 0);

  if (!hasIndex) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your vault (hybrid BM25 + semantic)…"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {results && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">
            {results.length} result{results.length === 1 ? "" : "s"} · fused from BM25 + vector via RRF
          </p>
          {results.map((r) => (
            <ResultRow key={r.id} result={r} />
          ))}
          {results.length === 0 && (
            <p className="text-sm text-neutral-400">No matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
