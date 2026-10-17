"use client";

import { useEffect, useRef, useState } from "react";

const EXAMPLE = "https://www.doctorzonebd.com/hospitals/ahsania-mission-cancer-general-hospital-194";

/* ---------------- types ---------------- */

type Verdict = { cache: string; render: string; signal: string | null; signalSource: string; summary: string };

type Result = {
  ok: boolean;
  error?: string;
  input: string;
  finalUrl: string;
  probedAt: string;
  verdict: Verdict;
  server: { server: string | null; poweredBy: string | null; contentType: string | null; vary: string | null };
  pass1Cache: string | null;
  timing: { pass1Ms: number; pass2Ms: number; deltaMs: number; bytes: number };
  freshness: {
    cacheControl: string | null;
    sMaxage: number | null;
    maxAge: number | null;
    staleWhileRevalidate: number | null;
    staleTime: string | null;
    prerender: string | null;
    age: number | null;
    date: string | null;
    expires: string | null;
    etag: string | null;
    lastModified: string | null;
    freshTtlHuman: string;
    freshUntil: string | null;
    remainingFreshHuman: string | null;
    staleUntil: string | null;
    ageUnknownNote: string | null;
  };
  probeHeaders: Record<string, string>;
};

type PsLab = { id: string; title: string; display: string; value: number | null; unit: string | null; score: number | null };
type PsField = { percentile: number | null; category: string | null } | null;
type PsResult = {
  ok: boolean;
  error?: string;
  hint?: string;
  finalUrl: string;
  strategy: string;
  score: number | null;
  fetchTime: string | null;
  cruxAvailable: boolean;
  lab: { fcp: PsLab; lcp: PsLab; tbt: PsLab; cls: PsLab; si: PsLab; tti: PsLab; ttfb: PsLab };
  field: { fcp: PsField; lcp: PsField; inp: PsField; cls: PsField; overallCategory: string | null };
  originField: PsResult["field"] | null;
  reportUrl: string;
};

// One independent loading lane per probe (cache / psi mobile / psi desktop).
type Load<T> = {
  state: "idle" | "loading" | "done" | "error";
  data: T | null;
  err: string;
  hint: string;
  startedAt: number | null;
};

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

function fmtLocal(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function badge(cache: string) {
  if (cache === "HIT") return "bg-success text-white";
  if (cache === "MISS") return "bg-danger text-white";
  if (cache === "STALE" || cache === "REVALIDATED") return "bg-warning text-white";
  if (cache === "BYPASS") return "bg-text-secondary text-white";
  return "bg-surface-alt text-text-primary border border-border";
}

function renderBadge(render: string) {
  if (render === "HOT") return "bg-success text-white";
  if (render === "COLD") return "bg-danger text-white";
  return "bg-surface-alt text-text-primary border border-border";
}

function scoreColor(s: number | null) {
  if (s === null) return "text-text-secondary";
  if (s >= 90) return "text-success";
  if (s >= 50) return "text-warning";
  return "text-danger";
}

function scoreRing(s: number | null) {
  if (s === null) return "stroke-text-muted";
  if (s >= 90) return "stroke-success";
  if (s >= 50) return "stroke-warning";
  return "stroke-danger";
}

// good/poor cutoffs: [goodMax, poorMin]
const MS_BANDS: Record<string, [number, number]> = {
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  tbt: [200, 600],
  si: [3400, 5800],
  tti: [3800, 7300],
  ttfb: [800, 1800],
  inp: [200, 500],
};

function msClass(kind: string, ms: number | null) {
  if (ms === null) return "text-text-secondary";
  const b = MS_BANDS[kind];
  if (!b) return "text-text-primary";
  if (ms <= b[0]) return "text-success";
  if (ms > b[1]) return "text-danger";
  return "text-warning";
}

function clsClass(v: number | null) {
  if (v === null) return "text-text-secondary";
  if (v <= 0.1) return "text-success";
  if (v > 0.25) return "text-danger";
  return "text-warning";
}

function fieldClass(cat: string | null) {
  if (cat === "FAST") return "bg-success text-white";
  if (cat === "AVERAGE") return "bg-warning text-white";
  if (cat === "SLOW") return "bg-danger text-white";
  return "bg-surface-alt text-text-secondary border border-border";
}

function fmtMs(ms: number | null) {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
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

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-light py-2 last:border-0">
      <span className="shrink-0 text-xs font-medium text-text-secondary">{k}</span>
      <span className={`text-right text-xs text-text-primary ${mono ? "font-mono break-all" : ""}`}>{v}</span>
    </div>
  );
}

function LabCard({ m, kind, isCls }: { m: PsLab; kind: string; isCls?: boolean }) {
  const cls = isCls ? clsClass(m.value) : msClass(kind, m.value);
  return (
    <div className="rounded-xl border border-border-light bg-surface-alt p-3">
      <p className="text-[11px] font-medium text-text-secondary">{m.title}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${cls}`}>{m.display}</p>
    </div>
  );
}

function FieldRow({ k, f, fmt }: { k: string; f: PsField; fmt: (v: number | null) => string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-light py-2 last:border-0">
      <span className="text-xs font-medium text-text-secondary">{k}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-text-primary">{fmt(f?.percentile ?? null)}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${fieldClass(f?.category ?? null)}`}>
          {f?.category ?? "—"}
        </span>
      </span>
    </div>
  );
}

function PsiResultBlock({ ps }: { ps: PsResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 80 80" className="h-16 w-16 -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" strokeWidth="8" className="stroke-border" />
          <circle
            cx="40" cy="40" r="34" fill="none" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(2 * Math.PI * 34 * (ps.score ?? 0)) / 100} ${2 * Math.PI * 34}`}
            className={scoreRing(ps.score)}
          />
          <text x="40" y="46" textAnchor="middle" fontSize="20" fontWeight="bold" className="fill-text-primary" transform="rotate(90 40 40)">
            {ps.score ?? "—"}
          </text>
        </svg>
        <div className="text-xs text-text-secondary">
          <p className={`text-sm font-bold ${scoreColor(ps.score)}`}>
            {ps.score === null ? "No score" : ps.score >= 90 ? "Good" : ps.score >= 50 ? "Needs improvement" : "Poor"}
            <span className="ml-1 font-normal text-text-muted">· {ps.strategy} · lab</span>
          </p>
          <p className="mt-1">Tested {ps.fetchTime ? fmtLocal(ps.fetchTime) : "—"}</p>
          <a href={ps.reportUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-primary underline">
            Open full report →
          </a>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Lab (this test run)</h3>
        <div className="grid grid-cols-2 gap-2">
          <LabCard m={ps.lab.fcp} kind="fcp" />
          <LabCard m={ps.lab.lcp} kind="lcp" />
          <LabCard m={ps.lab.tbt} kind="tbt" />
          <LabCard m={ps.lab.cls} kind="cls" isCls />
          <LabCard m={ps.lab.si} kind="si" />
          <LabCard m={ps.lab.tti} kind="tti" />
        </div>
        <p className="mt-2 font-mono text-[10px] text-text-muted">Server response (TTFB): {ps.lab.ttfb.display}</p>
      </div>

      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
          Field (CrUX — real users, 28d, p75)
        </h3>
        {!ps.cruxAvailable ? (
          <p className="py-2 text-xs text-text-muted">No field data — URL too new or too little traffic for CrUX.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-border-light bg-surface-alt p-3">
              <p className="mb-1 text-[10px] font-medium uppercase text-text-muted">This page</p>
              <FieldRow k="FCP" f={ps.field.fcp} fmt={fmtMs} />
              <FieldRow k="LCP" f={ps.field.lcp} fmt={fmtMs} />
              <FieldRow k="INP" f={ps.field.inp} fmt={fmtMs} />
              <FieldRow k="CLS" f={ps.field.cls} fmt={(v) => (v === null ? "—" : String(v))} />
            </div>
            {ps.originField && (
              <div className="rounded-xl border border-border-light bg-surface-alt p-3">
                <p className="mb-1 text-[10px] font-medium uppercase text-text-muted">Whole origin</p>
                <FieldRow k="FCP" f={ps.originField.fcp} fmt={fmtMs} />
                <FieldRow k="LCP" f={ps.originField.lcp} fmt={fmtMs} />
                <FieldRow k="INP" f={ps.originField.inp} fmt={fmtMs} />
                <FieldRow k="CLS" f={ps.originField.cls} fmt={(v) => (v === null ? "—" : String(v))} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PsiPanel({ title, s, now }: { title: string; s: Load<PsResult>; now: number }) {
  return (
    <div className="rounded-xl border border-border-light p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</p>
        <StatusChip s={s} now={now} />
      </div>
      {s.state === "idle" && <p className="py-6 text-center text-xs text-text-muted">Runs automatically with the check.</p>}
      {s.state === "loading" && <PsiSkeleton />}
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
  const [url, setUrl] = useState(EXAMPLE);
  const [cache, setCache] = useState<Load<Result>>(idle);
  const [psiM, setPsiM] = useState<Load<PsResult>>(idle);
  const [psiD, setPsiD] = useState<Load<PsResult>>(idle);
  const runRef = useRef(0);

  const anyLoading = cache.state === "loading" || psiM.state === "loading" || psiD.state === "loading";
  const now = useNow(anyLoading);
  const allIdle = cache.state === "idle" && psiM.state === "idle" && psiD.state === "idle";

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const u = url.trim();
    if (!u) return;
    const id = ++runRef.current; // any older in-flight run stops writing to state
    const startedAt = Date.now();
    const loading = { state: "loading" as const, data: null, err: "", hint: "", startedAt };
    setCache({ ...loading });
    setPsiM({ ...loading });
    setPsiD({ ...loading });

    const load = async <T,>(path: string, set: (v: Load<T>) => void) => {
      try {
        const r = await fetch(path);
        const j = await r.json().catch(() => ({}));
        if (runRef.current !== id) return; // a newer check owns the UI now
        if (!r.ok || j.error) {
          set({ state: "error", data: null, err: j.error || `HTTP ${r.status}`, hint: j.hint || j.keyHint || "", startedAt });
        } else {
          set({ state: "done", data: j as T, err: "", hint: "", startedAt });
        }
      } catch (e2) {
        if (runRef.current !== id) return;
        set({ state: "error", data: null, err: e2 instanceof Error ? e2.message : String(e2), hint: "", startedAt });
      }
    };

    // All three probes run in parallel — each section fills in as soon as it lands.
    void load(`/api/cache-inspect?url=${encodeURIComponent(u)}`, setCache);
    void load(`/api/pagespeed?strategy=mobile&url=${encodeURIComponent(u)}`, setPsiM);
    void load(`/api/pagespeed?strategy=desktop&url=${encodeURIComponent(u)}`, setPsiD);
  }

  const r = cache.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-text-primary">Cache inspector</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Paste any page URL and press Check — cache HIT/MISS, hot vs cold render, freshness, and PageSpeed (mobile
          + desktop) all run in parallel.
        </p>
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
          Cache probe takes ~2–4s; Google PageSpeed needs 20–60s per strategy and runs both in parallel.
        </p>
      </form>

      {allIdle && (
        <div className="rounded-2xl border border-border bg-surface-alt p-4 text-xs leading-relaxed text-text-secondary">
          ℹ Enter a URL and press <b>Check</b> — the cache verdict appears within a few seconds, PageSpeed panels fill
          in when Google finishes (each shows a live timer while running).
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

        {cache.state === "done" && r && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border-light bg-surface-alt p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge(r.verdict.cache)}`}>
                  {r.verdict.cache === "HIT" ? "✓ CACHE HIT" : r.verdict.cache === "MISS" ? "✕ CACHE MISS" : r.verdict.cache}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${renderBadge(r.verdict.render)}`}>
                  {r.verdict.render === "HOT" ? "🔥 HOT render" : r.verdict.render === "COLD" ? "❄ COLD render" : r.verdict.render}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-muted">
                  signal: {r.verdict.signalSource} = {r.verdict.signal ?? "—"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-text-primary">{r.verdict.summary}</p>
              <p className="mt-1 font-mono text-[11px] break-all text-text-muted">
                {r.finalUrl} · probed {fmtLocal(r.probedAt)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border-light p-4">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Render & timing</h3>
                <Row k="Pass 1" v={`${r.timing.pass1Ms} ms · ${r.pass1Cache ?? "no signal"}`} mono />
                <Row k="Pass 2" v={`${r.timing.pass2Ms} ms · ${r.verdict.signal ?? "no signal"}`} mono />
                <Row
                  k="Delta"
                  v={r.timing.deltaMs < 0 ? `${Math.abs(r.timing.deltaMs)} ms faster (hot ✓)` : r.timing.deltaMs > 150 ? `+${r.timing.deltaMs} ms slower (cold ✕)` : `${r.timing.deltaMs} ms (same)`}
                  mono
                />
                <Row k="Page size" v={`${(r.timing.bytes / 1024).toFixed(1)} KB`} mono />
                <Row k="Server" v={`${r.server.server ?? "—"} · ${r.server.poweredBy ?? "—"}`} mono />
              </div>
              <div className="rounded-2xl border border-border-light p-4">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Freshness / stale</h3>
                <Row k="Cache-Control" v={r.freshness.cacheControl ?? "none"} mono />
                <Row k="Fresh window" v={r.freshness.freshTtlHuman} mono />
                <Row k="Age" v={r.freshness.age !== null ? `${r.freshness.age}s` : "not sent"} mono />
                <Row k="Fresh until" v={fmtLocal(r.freshness.freshUntil)} mono />
                <Row k="Stale-until (SWR)" v={fmtLocal(r.freshness.staleUntil)} mono />
                <Row k="Router stale-time" v={r.freshness.staleTime ? `${r.freshness.staleTime}s` : "—"} mono />
                <Row k="Prerender" v={r.freshness.prerender ? `yes (${r.freshness.prerender})` : "—"} mono />
              </div>
            </div>

            {r.freshness.ageUnknownNote && (
              <div className="rounded-xl border border-border-light bg-surface-alt p-3 text-xs leading-relaxed text-text-secondary">
                ℹ {r.freshness.ageUnknownNote}
              </div>
            )}

            <div className="rounded-2xl border border-border-light p-4">
              <h3 className="mb-2 text-sm font-semibold text-text-primary">Validators & variants</h3>
              <Row k="ETag" v={r.freshness.etag ?? "—"} mono />
              <Row k="Last-Modified" v={r.freshness.lastModified ? fmtLocal(r.freshness.lastModified) : "—"} mono />
              <Row k="Date" v={r.freshness.date ? fmtLocal(r.freshness.date) : "—"} mono />
              <Row k="Expires" v={r.freshness.expires ? fmtLocal(r.freshness.expires) : "—"} mono />
              <Row k="Vary" v={r.server.vary ?? "—"} mono />
              <Row k="Content-Type" v={r.server.contentType ?? "—"} mono />
            </div>

            <details className="rounded-2xl border border-border-light p-4">
              <summary className="cursor-pointer text-sm font-semibold text-text-primary">
                Raw response headers ({Object.keys(r.probeHeaders).length})
              </summary>
              <div className="mt-2 overflow-x-auto rounded-xl bg-sidebar-bg p-3">
                <pre className="font-mono text-[11px] leading-relaxed text-white">
                  {Object.entries(r.probeHeaders)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n")}
                </pre>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* page speed — both strategies in parallel */}
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">PageSpeed</h2>
          <span className="text-[11px] text-text-muted">pagespeed.web.dev engine · Lighthouse lab + CrUX field</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <PsiPanel title="📱 Mobile" s={psiM} now={now} />
          <PsiPanel title="🖥 Desktop" s={psiD} now={now} />
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
          <li><b>CDN caveat:</b> on-demand <span className="font-mono">revalidateTag / revalidatePath</span> clears the Next.js server cache only — purge the CDN too.</li>
        </ul>
      </div>
    </div>
  );
}
