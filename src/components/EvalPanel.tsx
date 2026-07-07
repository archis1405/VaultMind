import { useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { EVAL_SET } from "../eval/evalSet";
import { runEval, type EvalReport } from "../eval/evaluate";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** A big headline metric tile. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * Retrieval eval runner. Runs the hand-labeled EVAL_SET against the live index
 * via the real hybrid pipeline and reports recall@5 / recall@10 (and hit rate),
 * with a per-case breakdown of where each expected source landed.
 */
export function EvalPanel() {
  const retrieve = useVaultStore((s) => s.retrieve);
  const hasIndex = useVaultStore((s) => s.embeddedChunks.length > 0);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [report, setReport] = useState<EvalReport>();
  const [error, setError] = useState<string>();

  const run = async () => {
    setRunning(true);
    setError(undefined);
    setReport(undefined);
    try {
      const r = await runEval(
        EVAL_SET,
        async (query, topK) => {
          const results = await retrieve(query, topK);
          return results.map((res) => ({ notePath: res.chunk.notePath, page: res.chunk.page }));
        },
        { onProgress: (done, total) => setProgress({ done, total }) },
      );
      setReport(r);
      // Also log a copy-pasteable table to the console for quoting.
      // eslint-disable-next-line no-console
      console.table(
        r.cases.map((c) => ({
          query: c.query,
          expected: c.expected.map((e) => e.path).join(", "),
          ranks: c.ranks.map((x) => x ?? "—").join(", "),
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Retrieval eval</h2>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !hasIndex}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {running
              ? progress
                ? `Running ${progress.done}/${progress.total}…`
                : "Running…"
              : "Run"}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {EVAL_SET.length} labeled cases · edit{" "}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">src/eval/evalSet.ts</code>{" "}
          with your own vault + book pairs.
          {!hasIndex && " Build an index first."}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="recall@5" value={pct(report.recallAt[5])} />
            <Metric label="recall@10" value={pct(report.recallAt[10])} />
            <Metric label="hit@5" value={pct(report.hitRateAt[5])} />
            <Metric label="hit@10" value={pct(report.hitRateAt[10])} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-400">
                <tr>
                  <th className="py-1 pr-2">Query</th>
                  <th className="py-1 pr-2">Expected</th>
                  <th className="py-1 pr-2">Rank(s)</th>
                  <th className="py-1">@5 / @10</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((c, i) => {
                  const hit5 = c.ranks.some((r) => r !== null && r <= 5);
                  const hit10 = c.ranks.some((r) => r !== null && r <= 10);
                  return (
                    <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="max-w-[16rem] truncate py-1.5 pr-2" title={c.query}>
                        {c.query}
                      </td>
                      <td className="max-w-[10rem] truncate py-1.5 pr-2 text-neutral-500">
                        {c.expected.map((e) => e.path.split("/").pop()).join(", ")}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-neutral-500">
                        {c.ranks.map((r) => r ?? "—").join(", ")}
                      </td>
                      <td className="py-1.5">
                        <span className={hit5 ? "text-green-600" : "text-neutral-300"}>●</span>{" "}
                        <span className={hit10 ? "text-green-600" : "text-neutral-300"}>●</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-400">Full per-case table also logged to the console.</p>
        </>
      )}
    </div>
  );
}
