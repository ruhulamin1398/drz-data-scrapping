"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CacheResultBlock, PsiResultBlock, fmtLocal, type PsResult, type Result } from "@/components/cache-report";

type Lane = { data: PsResult | null; err: string | null } | null;

type Scan = {
  id: number;
  created_at: string;
  updated_at: string;
  url: string;
  final_url: string | null;
  status: string;
  note: string | null;
  verdict: string | null;
  render: string | null;
  cache_ms: number | null;
  cache_json: Result | null;
  cache_error: string | null;
  psi_mobile_1: Lane;
  psi_mobile_2: Lane;
  psi_desktop_1: Lane;
  psi_desktop_2: Lane;
  score_mobile_1: number | null;
  score_mobile_2: number | null;
  score_desktop_1: number | null;
  score_desktop_2: number | null;
};

function verdictPill(v: string | null) {
  if (v === "HIT") return "bg-success text-white";
  if (v === "MISS") return "bg-danger text-white";
  if (v === "STALE" || v === "REVALIDATED") return "bg-warning text-white";
  if (v === "BYPASS") return "bg-text-secondary text-white";
  return "bg-surface-alt text-text-primary border border-border";
}

function scoreCls(s: number | null) {
  if (s === null) return "text-text-muted";
  if (s >= 90) return "text-success";
  if (s >= 50) return "text-warning";
  return "text-danger";
}

const fmt = (s: number | null) => (s === null ? "—" : String(s));

function LanePanel({ label, lane }: { label: string; lane: Lane }) {
  return (
    <div className="rounded-xl border border-border-light p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
        {lane?.data ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">recorded</span>
        ) : lane?.err ? (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">error</span>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-text-muted">
            not recorded
          </span>
        )}
      </div>
      {lane?.data ? (
        <PsiResultBlock ps={lane.data} />
      ) : lane?.err ? (
        <p className="py-2 text-xs text-danger">{lane.err}</p>
      ) : (
        <p className="py-6 text-center text-xs text-text-muted">This run was never recorded (check interrupted).</p>
      )}
    </div>
  );
}

export default function CacheScanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [scan, setScan] = useState<Scan | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/cache-scans/${id}`);
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || j.error) setErr(j.error || `HTTP ${r.status}`);
        else {
          setScan(j.scan);
          setStale(
            j.scan.status === "running" && Date.now() - new Date(j.scan.created_at).getTime() > 10 * 60 * 1000
          );
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const staleRunning = stale && scan?.status === "running";

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/cache/history" className="text-xs font-medium text-primary hover:underline">
          ← Scan history
        </Link>
        <Link
          href={`/cache?url=${encodeURIComponent(scan?.url ?? "")}`}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
        >
          Run a fresh check →
        </Link>
      </div>

      {loading && <p className="py-10 text-center text-sm text-text-secondary">Loading scan…</p>}
      {!loading && err && (
        <div className="rounded-2xl border border-danger bg-surface p-4 text-sm text-danger">⚠ {err}</div>
      )}

      {scan && (
        <>
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-text-primary">Scan #{scan.id}</h1>
              {scan.verdict && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${verdictPill(scan.verdict)}`}>
                  {scan.verdict === "HIT" ? "✓ CACHE HIT" : scan.verdict === "MISS" ? "✕ CACHE MISS" : scan.verdict}
                </span>
              )}
              {scan.render && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${verdictPill(scan.render === "HOT" ? "HIT" : "MISS")}`}>
                  {scan.render === "HOT" ? "🔥 HOT" : scan.render === "COLD" ? "❄ COLD" : scan.render}
                </span>
              )}
              {scan.status === "running" && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${staleRunning ? "bg-surface-alt text-text-muted" : "bg-primary/15 text-primary-dark"}`}>
                  {staleRunning ? "partial — never finished" : "running…"}
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-text-muted">
                {scan.cache_ms !== null && `${scan.cache_ms} ms · `}probed {fmtLocal(scan.created_at)}
              </span>
            </div>
            <p className="mt-2 font-mono text-[11px] break-all text-text-secondary">{scan.url}</p>
            {scan.final_url && scan.final_url !== scan.url && (
              <p className="mt-1 font-mono text-[11px] break-all text-text-muted">final: {scan.final_url}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-secondary">
              <span>
                📱 mobile: <b className={scoreCls(scan.score_mobile_1)}>{fmt(scan.score_mobile_1)}</b>
                {" · "}
                <b className={scoreCls(scan.score_mobile_2)}>{fmt(scan.score_mobile_2)}</b>
              </span>
              <span>
                🖥 desktop: <b className={scoreCls(scan.score_desktop_1)}>{fmt(scan.score_desktop_1)}</b>
                {" · "}
                <b className={scoreCls(scan.score_desktop_2)}>{fmt(scan.score_desktop_2)}</b>
              </span>
            </div>
            {staleRunning && (
              <p className="mt-2 rounded-xl border border-border-light bg-surface-alt p-3 text-[11px] leading-relaxed text-text-secondary">
                ℹ This scan started but never sent its final “done” patch — the tab was probably closed mid-check. The
                sections below show whatever was recorded before that.
              </p>
            )}
          </div>

          {/* cache */}
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Cache & render</h2>
            </div>
            {scan.cache_json ? (
              <CacheResultBlock r={scan.cache_json} />
            ) : scan.cache_error ? (
              <div className="rounded-xl border border-danger p-3 text-xs text-danger">{scan.cache_error}</div>
            ) : (
              <p className="py-4 text-center text-xs text-text-muted">Cache probe was not recorded for this scan.</p>
            )}
          </section>

          {/* page speed — 2 runs per strategy */}
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">PageSpeed</h2>
              <span className="text-[11px] text-text-muted">2 runs per strategy — Lighthouse lab + CrUX field</span>
            </div>
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">📱 Mobile</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <LanePanel label="Run 1" lane={scan.psi_mobile_1} />
                  <LanePanel label="Run 2" lane={scan.psi_mobile_2} />
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">🖥 Desktop</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <LanePanel label="Run 1" lane={scan.psi_desktop_1} />
                  <LanePanel label="Run 2" lane={scan.psi_desktop_2} />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
