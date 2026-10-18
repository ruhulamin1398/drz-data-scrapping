"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CacheResultBlock, PsiResultBlock, type PsResult, type Result } from "@/components/cache-report";

const EXAMPLE = "https://www.doctorzonebd.com/hospitals/ahsania-mission-cancer-general-hospital-194";

// One independent loading lane per probe (cache / psi mobile / psi desktop).
type Load<T> = {
  state: "idle" | "loading" | "done" | "error";
  data: T | null;
  err: string;
  hint: string;
  startedAt: number | null;
};

// What gets persisted per lane once it settles.
type LanePayload = { state: "done" | "error"; data: unknown; err: string };

const idle = <T,>(): Load<T> => ({ state: "idle", data: null, err: "", hint: "", startedAt: null });

/* ---------------- helpers ---------------- */

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/* ---------------- shared UI bits ---------------- */

function StatusChip({ s, now, suffix }: { s: Load<unknown>; now: number; suffix?: string }) {
  if (s.state === "idle")
    return <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-text-muted">idle</span>;
  if (s.state === "loading") {
    const secs = s.startedAt ? Math.max(0, Math.round((now - s.startedAt) / 1000)) : 0;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary-dark">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        running {secs}s
      </span>
    );
  }
  if (s.state === "done")
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
        done{suffix ? ` · ${suffix}` : ""}
      </span>
    );
  return <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">error</span>;
}

function Bar({ w }: { w: string }) {
  return <div className={`h-3 animate-pulse rounded bg-border-light ${w}`} />;
}

function CacheSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex gap-2">
        <div className="h-6 w-28 animate-pulse rounded-full bg-border-light" />
        <div className="h-6 w-24 animate-pulse rounded-full bg-border-light" />
      </div>
      <div className="space-y-2">
        <Bar w="w-3/4" />
        <Bar w="w-1/2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-border-light p-4">
            <Bar w="w-1/3" />
            <Bar w="w-full" />
            <Bar w="w-5/6" />
            <Bar w="w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PsiSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-border-light" />
        <div className="flex-1 space-y-2">
          <Bar w="w-1/2" />
          <Bar w="w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border-light bg-surface-alt p-3">
            <Bar w="w-2/3" />
            <Bar w="w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RunPanel({ label, s, now, idleHint }: { label: string; s: Load<PsResult>; now: number; idleHint: string }) {
  const secs = s.startedAt ? Math.max(0, Math.round((now - s.startedAt) / 1000)) : 0;
  return (
    <div className="rounded-xl border border-border-light p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
        <StatusChip s={s} now={now} />
      </div>
      {s.state === "idle" && <p className="py-6 text-center text-xs text-text-muted">{idleHint}</p>}
      {s.state === "loading" && (
        <>
          <PsiSkeleton />
          {secs > 90 && (
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              ⏳ Google is taking longer than usual ({secs}s) — Lighthouse queues under load. It gives up cleanly at
              200s so you can retry (repeat runs often hit Google&rsquo;s cache and return in seconds).
            </p>
          )}
        </>
      )}
      {s.state === "error" && (
        <div className="space-y-2 py-2">
          <p className="text-xs text-danger">{s.err}</p>
          {s.hint && (
            <p className="rounded-lg border border-warning p-2 text-[11px] leading-relaxed text-text-secondary">💡 {s.hint}</p>
          )}
          <p className="text-[11px] text-text-muted">Google Lighthouse sometimes fails on specific pages — press Check to retry.</p>
        </div>
      )}
      {s.state === "done" && s.data && <PsiResultBlock ps={s.data} />}
    </div>
  );
}

/* ---------------- page ---------------- */

export default function CachePage() {
  // Prefill from ?url= (used by the history detail "Run a fresh check" link).
  const [url, setUrl] = useState(() => {
    if (typeof window === "undefined") return EXAMPLE;
    return new URLSearchParams(window.location.search).get("url") || EXAMPLE;
  });
  const [cache, setCache] = useState<Load<Result>>(idle);
  const [psiM1, setPsiM1] = useState<Load<PsResult>>(idle);
  const [psiM2, setPsiM2] = useState<Load<PsResult>>(idle);
  const [psiD1, setPsiD1] = useState<Load<PsResult>>(idle);
  const [psiD2, setPsiD2] = useState<Load<PsResult>>(idle);
  const runRef = useRef(0);

  const psiAll = [psiM1, psiM2, psiD1, psiD2];
  const anyLoading = cache.state === "loading" || psiAll.some((s) => s.state === "loading");
  const now = useNow(anyLoading);
  const allIdle = cache.state === "idle" && psiAll.every((s) => s.state === "idle");

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const u = url.trim();
    if (!u) return;
    const id = ++runRef.current; // any older in-flight run stops writing to UI state
    const startedAt = Date.now();
    const loading = { state: "loading" as const, data: null, err: "", hint: "", startedAt };
    setCache({ ...loading });
    setPsiM1({ ...loading });
    setPsiD1({ ...loading });
    setPsiM2({ ...idle<PsResult>() });
    setPsiD2({ ...idle<PsResult>() });

    // --- history persistence: create the scan row now, patch each lane as it settles ---
    const scanIdP: Promise<number | null> = fetch("/api/cache-scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: u }),
    })
      .then((r) => r.json())
      .then((j) => (typeof j.id === "number" ? (j.id as number) : null))
      .catch(() => null);

    const patchScan = (sid: number, body: Record<string, unknown>) => {
      void fetch(`/api/cache-scans/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    };

    const saveLane = (key: string, p: Promise<LanePayload>) => {
      void p.then((lane) => {
        void scanIdP.then((sid) => {
          if (sid) patchScan(sid, { [key]: lane });
        });
      });
    };

    // Runs to completion even when superseded — the history row keeps its own data,
    // only the UI writes are guarded.
    const load = async <T,>(path: string, set: (v: Load<T>) => void): Promise<LanePayload> => {
      try {
        const r = await fetch(path);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) {
          const err = j.error || `HTTP ${r.status}`;
          if (runRef.current === id) {
            set({ state: "error", data: null, err, hint: j.hint || j.keyHint || "", startedAt });
          }
          return { state: "error", data: null, err };
        }
        if (runRef.current === id) {
          set({ state: "done", data: j as T, err: "", hint: "", startedAt });
        }
        return { state: "done", data: j, err: "" };
      } catch (e2) {
        const err = e2 instanceof Error ? e2.message : String(e2);
        if (runRef.current === id) {
          set({ state: "error", data: null, err, hint: "", startedAt });
        }
        return { state: "error", data: null, err };
      }
    };

    const psi = (strategy: "mobile" | "desktop") =>
      `/api/pagespeed?strategy=${strategy}&url=${encodeURIComponent(u)}`;

    // Cache probe runs alongside everything else.
    const cacheP = load(`/api/cache-inspect?url=${encodeURIComponent(u)}`, setCache);
    saveLane("cache", cacheP);

    // Round 1 — both strategies in parallel. Round 2 starts only when round 1
    // (mobile AND desktop) has fully settled, so each strategy gets 2 reports.
    const r1m = load(psi("mobile"), setPsiM1);
    const r1d = load(psi("desktop"), setPsiD1);
    saveLane("psi_mobile_1", r1m);
    saveLane("psi_desktop_1", r1d);

    void (async () => {
      await Promise.allSettled([r1m, r1d]);
      if (runRef.current === id) {
        const s2 = { state: "loading" as const, data: null, err: "", hint: "", startedAt: Date.now() };
        setPsiM2({ ...s2 });
        setPsiD2({ ...s2 });
      }
      // Round 2 runs for this scan row even if the UI moved on to a newer check.
      const r2m = load(psi("mobile"), setPsiM2);
      const r2d = load(psi("desktop"), setPsiD2);
      saveLane("psi_mobile_2", r2m);
      saveLane("psi_desktop_2", r2d);
      await Promise.allSettled([cacheP, r2m, r2d]);
      const sid = await scanIdP;
      if (sid) patchScan(sid, { status: "done" });
    })();
  }

  const r = cache.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Cache inspector</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Paste any page URL and press Check — cache HIT/MISS, hot vs cold render, freshness, and PageSpeed: 2 mobile
            + 2 desktop Lighthouse runs. Every scan is saved to history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/cache/history"
            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
          >
            Scan history →
          </Link>
          <Link
            href={`/cache/history?url=${encodeURIComponent(url.trim())}`}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
          >
            This URL&rsquo;s history →
          </Link>
        </div>
      </div>

      <form onSubmit={run} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUrl(EXAMPLE)}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
            >
              Example
            </button>
            <button
              type="submit"
              disabled={anyLoading}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {anyLoading ? "Checking…" : "Check"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          Cache probe takes ~2–4s. PageSpeed runs each strategy <b>twice</b> — round 1 (mobile + desktop) in parallel,
          round 2 starts automatically once round 1 finishes. Up to 200s per run.
        </p>
      </form>

      {allIdle && (
        <div className="rounded-2xl border border-border bg-surface-alt p-4 text-xs leading-relaxed text-text-secondary">
          ℹ Enter a URL and press <b>Check</b> — the cache verdict appears within a few seconds. PageSpeed runs 4
          Lighthouse tests total (2 mobile + 2 desktop): round 1 in parallel, then round 2, each with a live timer.
        </div>
      )}

      {/* cache */}
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Cache & render</h2>
          <StatusChip s={cache} now={now} suffix={cache.state === "done" && r ? `${r.timing.pass2Ms} ms` : undefined} />
        </div>

        {cache.state === "idle" && <p className="py-4 text-center text-xs text-text-muted">Waiting for a URL check.</p>}
        {cache.state === "loading" && <CacheSkeleton />}
        {cache.state === "error" && (
          <div className="rounded-xl border border-danger p-3 text-xs text-danger">{cache.err}</div>
        )}
        {cache.state === "done" && r && <CacheResultBlock r={r} />}
      </section>

      {/* page speed — 2 runs per strategy */}
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">PageSpeed</h2>
          <span className="text-[11px] text-text-muted">
            pagespeed.web.dev engine · 2 runs per strategy — round 2 starts after round 1 finishes
          </span>
        </div>
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">📱 Mobile</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <RunPanel label="Run 1" s={psiM1} now={now} idleHint="Runs automatically with the check." />
              <RunPanel label="Run 2" s={psiM2} now={now} idleHint="Starts after round 1 (mobile + desktop) finishes." />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">🖥 Desktop</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <RunPanel label="Run 1" s={psiD1} now={now} idleHint="Runs automatically with the check." />
              <RunPanel label="Run 2" s={psiD2} now={now} idleHint="Starts after round 1 (mobile + desktop) finishes." />
            </div>
          </div>
        </div>
      </section>

      {/* explainer */}
      <div className="rounded-2xl border border-border bg-surface p-4 text-xs leading-relaxed text-text-secondary shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-text-primary">How to read this</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>HIT + hot</b> — served from the Next.js prerender/ISR cache, no server work. This is the goal state.</li>
          <li><b>MISS + cold</b> — server rendered fresh just now (slow). Normal after deploy / on-demand revalidation; check again and it flips to HIT.</li>
          <li><b>STALE + hot</b> — old copy served instantly while Next.js regenerates in the background (stale-while-revalidate).</li>
          <li><b>DYNAMIC / BYPASS</b> (<span className="font-mono">private, no-cache, no-store</span>) — route opts out of caching; every visit is cold by design.</li>
          <li><b>s-maxage=31536000</b> = static prerender (fresh up to 1 year). <b>s-maxage=N + stale-while-revalidate=M</b> = ISR with N-second revalidation.</li>
          <li><b>Lighthouse FAILED_DOCUMENT_REQUEST</b> — Google&rsquo;s crawler couldn&rsquo;t load that specific page (heavy/slow, redirect, or bot protection). Other probes still work.</li>
          <li><b>2 runs per strategy</b> — Lighthouse scores naturally vary run to run; compare Run 1 vs Run 2. If Google just analyzed the URL seconds ago, Run 2 may return Google&rsquo;s cached copy (same fetch time).</li>
          <li><b>History</b> — every check is saved; open <b>Scan history</b> above to revisit or compare past runs (including PageSpeed reports).</li>
          <li><b>CDN caveat:</b> on-demand <span className="font-mono">revalidateTag / revalidatePath</span> clears the Next.js server cache only — purge the CDN too.</li>
        </ul>
      </div>
    </div>
  );
}
