"use client";

import { useState } from "react";

const EXAMPLE = "https://www.doctorzonebd.com/hospitals/ahsania-mission-cancer-general-hospital-194";

type Verdict = {
  cache: string;
  render: string;
  signal: string | null;
  signalSource: string;
  summary: string;
};

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

function fmtLocal(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-light py-2 last:border-0">
      <span className="shrink-0 text-xs font-medium text-text-secondary">{k}</span>
      <span className={`text-right text-xs text-text-primary ${mono ? "font-mono break-all" : ""}`}>{v}</span>
    </div>
  );
}

export default function CachePage() {
  const [url, setUrl] = useState(EXAMPLE);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [r, setR] = useState<Result | null>(null);

  async function inspect(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setErr("");
    setR(null);
    try {
      const res = await fetch(`/api/cache-inspect?url=${encodeURIComponent(url.trim())}`);
      const j = await res.json();
      if (!res.ok || j.error) setErr(j.error || `HTTP ${res.status}`);
      else setR(j as Result);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-text-primary">Cache inspector</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Paste any page URL — the server probes it twice and reports cache HIT / MISS, hot vs cold render, and
          freshness / stale windows from the real response headers.
        </p>
      </div>

      <form onSubmit={inspect} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row">
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
            disabled={loading}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Probing…" : "Inspect"}
          </button>
        </div>
      </form>

      {err && (
        <div className="rounded-2xl border border-danger bg-surface p-4 text-sm text-danger">{err}</div>
      )}

      {r && (
        <>
          {/* verdict */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
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

          {/* key facts */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-text-primary">Render & timing</h2>
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
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-text-primary">Freshness / stale</h2>
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
            <div className="rounded-2xl border border-border bg-surface-alt p-4 text-xs leading-relaxed text-text-secondary">
              ℹ {r.freshness.ageUnknownNote}
            </div>
          )}

          {/* identity */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">Validators & variants</h2>
            <Row k="ETag" v={r.freshness.etag ?? "—"} mono />
            <Row k="Last-Modified" v={r.freshness.lastModified ? fmtLocal(r.freshness.lastModified) : "—"} mono />
            <Row k="Date" v={r.freshness.date ? fmtLocal(r.freshness.date) : "—"} mono />
            <Row k="Expires" v={r.freshness.expires ? fmtLocal(r.freshness.expires) : "—"} mono />
            <Row k="Vary" v={r.server.vary ?? "—"} mono />
            <Row k="Content-Type" v={r.server.contentType ?? "—"} mono />
          </div>

          {/* raw headers */}
          <details className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
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

          {/* explainer */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm text-xs leading-relaxed text-text-secondary">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">How to read this</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>HIT + hot</b> — served from the Next.js prerender/ISR cache, no server work. This is the goal state.</li>
              <li><b>MISS + cold</b> — server rendered fresh just now (slow). Normal right after deploy or on-demand revalidation; inspect again and it should flip to HIT.</li>
              <li><b>STALE + hot</b> — old copy served instantly while Next.js regenerates in the background (stale-while-revalidate). Next visit is fresh.</li>
              <li><b>DYNAMIC / BYPASS</b> (<span className="font-mono">private, no-cache, no-store</span>) — route opts out of caching; every visit is cold by design.</li>
              <li><b>s-maxage=31536000</b> = static prerender, fresh up to 1 year. <b>s-maxage=N + stale-while-revalidate=M</b> = ISR with N-second revalidation.</li>
              <li><b>CDN caveat:</b> on-demand <span className="font-mono">revalidateTag / revalidatePath</span> clears the Next.js server cache only — purge the CDN too or it keeps serving its copy until s-maxage expires.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
