"use client";

// Shared rendering for cache-inspect runs — used by the /cache inspector and the
// /cache/history/[id] detail page so both show identical reports.

export type Verdict = { cache: string; render: string; signal: string | null; signalSource: string; summary: string };

export type Result = {
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

export type PsLab = { id: string; title: string; display: string; value: number | null; unit: string | null; score: number | null };
export type PsField = { percentile: number | null; category: string | null } | null;
export type PsResult = {
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

/* ---------------- helpers ---------------- */

export function fmtLocal(iso: string | null) {
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

export function scoreColor(s: number | null) {
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

/* ---------------- report blocks ---------------- */

export function PsiResultBlock({ ps }: { ps: PsResult }) {
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

export function CacheResultBlock({ r }: { r: Result }) {
  return (
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
  );
}
