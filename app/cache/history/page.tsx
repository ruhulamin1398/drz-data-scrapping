"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Scan = {
  id: number;
  created_at: string;
  url: string;
  final_url: string | null;
  status: string;
  verdict: string | null;
  render: string | null;
  cache_ms: number | null;
  score_mobile_1: number | null;
  score_mobile_2: number | null;
  score_desktop_1: number | null;
  score_desktop_2: number | null;
  cache_error: string | null;
};

const PER = 15;

function readUrlParam() {
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("url") ?? "";
}

function verdictPill(v: string | null) {
  if (v === "HIT") return "bg-success/15 text-success";
  if (v === "MISS") return "bg-danger/15 text-danger";
  if (v === "STALE" || v === "REVALIDATED") return "bg-warning/15 text-warning";
  return "bg-surface-alt text-text-muted";
}

function renderPill(v: string | null) {
  if (v === "HOT") return "bg-success/15 text-success";
  if (v === "COLD") return "bg-danger/15 text-danger";
  return "bg-surface-alt text-text-muted";
}

function scoreCls(s: number | null) {
  if (s === null) return "text-text-muted";
  if (s >= 90) return "text-success";
  if (s >= 50) return "text-warning";
  return "text-danger";
}

const fmt = (s: number | null) => (s === null ? "—" : String(s));

function prettyPath(u: string) {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch {
    return u;
  }
}

function staleRunning(createdAt: string, loadedAt: number) {
  return loadedAt > 0 && new Date(createdAt).getTime() < loadedAt - 10 * 60 * 1000;
}

export default function CacheHistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterInput, setFilterInput] = useState<string>(readUrlParam);
  const [applied, setApplied] = useState<string>(readUrlParam);
  const [loadedAt, setLoadedAt] = useState(0);

  async function load(p = page, urlFilter = applied) {
    try {
      const q = new URLSearchParams({ page: String(p), per: String(PER) });
      if (urlFilter) q.set("url", urlFilter);
      const r = await fetch(`/api/cache-scans?${q.toString()}`);
      const j = await r.json();
      if (!j.error) {
        setScans(j.scans);
        setPage(j.page);
        setTotalPages(j.totalPages);
        setTotal(j.total);
        setLoadedAt(Date.now());
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    // Initial load — all setState calls happen after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilter(e: React.FormEvent) {
    e.preventDefault();
    const u = filterInput.trim();
    setApplied(u);
    load(1, u);
  }

  async function del(id: number) {
    if (!confirm(`Delete scan #${id} from history?`)) return;
    try {
      await fetch(`/api/cache-scans/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    load();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Cache scan history</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Every inspector run with its cache verdict and PageSpeed scores, newest first.
            {total > 0 && ` ${total} total.`}
          </p>
        </div>
        <Link
          href="/cache"
          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
        >
          ← New check
        </Link>
      </div>

      <form onSubmit={applyFilter} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="Filter by exact URL (optional)"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          {applied && (
            <button
              type="button"
              onClick={() => {
                setFilterInput("");
                setApplied("");
                load(1, "");
              }}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
            >
              Clear
            </button>
          )}
          <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white">
            Filter
          </button>
        </div>
      </form>

      <div className="mt-4 space-y-2">
        {scans.map((s) => (
          <div key={s.id} className="flex items-stretch gap-1.5">
            <Link
              href={`/cache/history/${s.id}`}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 transition hover:bg-surface-alt"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${verdictPill(s.verdict)}`}>
                  {s.verdict ?? "—"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${renderPill(s.render)}`}>
                  {s.render ?? "—"}
                </span>
                {s.status === "running" &&
                  (staleRunning(s.created_at, loadedAt) ? (
                    <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-semibold text-text-muted">partial</span>
                  ) : (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary-dark">
                      running…
                    </span>
                  ))}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={s.url}>
                  {prettyPath(s.url)}
                </span>
                <span className="shrink-0 text-[11px] text-text-muted">
                  {new Date(s.created_at).toLocaleString()}
                  {s.cache_ms !== null && ` · ${s.cache_ms} ms`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 font-mono text-[11px] text-text-secondary">
                <span>
                  📱 <b className={scoreCls(s.score_mobile_1)}>{fmt(s.score_mobile_1)}</b>
                  {" · "}
                  <b className={scoreCls(s.score_mobile_2)}>{fmt(s.score_mobile_2)}</b>
                </span>
                <span>
                  🖥 <b className={scoreCls(s.score_desktop_1)}>{fmt(s.score_desktop_1)}</b>
                  {" · "}
                  <b className={scoreCls(s.score_desktop_2)}>{fmt(s.score_desktop_2)}</b>
                </span>
                <span className="ml-auto text-primary">view →</span>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => del(s.id)}
              title="Delete scan"
              className="rounded-xl border border-border px-2.5 text-text-muted transition hover:bg-danger/10 hover:text-danger"
            >
              🗑
            </button>
          </div>
        ))}
        {scans.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
            No scans recorded yet — run a check on the inspector and it will appear here.
          </p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </main>
  );
}
