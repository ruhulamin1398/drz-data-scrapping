"use client";

import { useEffect, useState } from "react";

type Run = {
  id: number; started_at: string; finished_at: string | null; duration_ms: number | null;
  status: string; claimed: number; succeeded: number; failed: number; remaining: number; error: string | null;
};

const PER = 15;
const FILTERS = ["all", "done", "started", "already-running", "paused", "running", "error"] as const;

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  async function load(p = page, f = filter) {
    try {
      const r = await fetch(`/api/cron/runs?page=${p}&per=${PER}${f !== "all" ? `&status=${f}` : ""}`);
      const j = await r.json();
      if (!j.error) {
        setRuns(j.runs); setPage(j.page); setTotalPages(j.totalPages); setTotal(j.total);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { load(1, filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pill = (s: string) =>
    s === "done" ? "bg-success/15 text-success"
    : s === "started" ? "bg-primary/15 text-primary-dark"
    : s === "paused" ? "bg-surface-alt text-text-muted"
    : s === "running" ? "bg-primary/15 text-primary-dark"
    : s === "already-running" ? "bg-warning/15 text-warning"
    : "bg-danger/15 text-danger";

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-bold text-text-primary">Cron history</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Every processor tick, newest first.{total > 0 && ` ${total} total.`}
      </p>

      <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-alt p-1 text-sm">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 font-medium capitalize transition ${
              filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}>{f}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {runs.map((t) => (
          <div key={t.id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill(t.status)}`}>{t.status}</span>
              <span className="text-xs text-text-secondary">
                {new Date(t.started_at).toLocaleString()}
                {t.duration_ms != null && ` · ${(t.duration_ms / 1000).toFixed(1)}s`}
              </span>
              {t.status === "done" && (
                <span className="ml-auto font-mono text-[11px] text-text-secondary">
                  +{t.claimed} ✓{t.succeeded} ✗{t.failed} · {t.remaining} left
                </span>
              )}
            </div>
            {t.error && <p className="mt-1 font-mono text-[11px] text-danger">{t.error}</p>}
          </div>
        ))}
        {runs.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
            No ticks recorded yet — history appears after the first cron hit.
          </p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button onClick={() => load(page - 1)} disabled={page <= 1}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">← Prev</button>
          <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= totalPages}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">Next →</button>
        </div>
      )}
    </main>
  );
}
