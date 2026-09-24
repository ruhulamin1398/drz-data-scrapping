"use client";

import { useEffect, useRef, useState } from "react";
import QueueSwitch, { TasksPerTickInput } from "@/components/QueueSwitch";

type PRow = {
  id: number; source_url: string;
  status: "pending" | "processing" | "success" | "failed";
  http_code: number | null; duration_ms: number | null; fail_reason: string | null;
};

export default function Prewarm() {
  const [rows, setRows] = useState<PRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, success: 0, failed: 0 });
  const [filter, setFilter] = useState<"all" | "pending" | "processing" | "success" | "failed">("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | "all">(20);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  const [done, setDone] = useState(0);
  const [active, setActive] = useState<string[]>([]);
  const [settings, setSettings] = useState({ enabled: false, prewarm_enabled: true, prewarm_tasks_per_tick: 10 });
  const [sitemap, setSitemap] = useState("");
  const [loading, setLoading] = useState(false);
  const stopRef = useRef(false);
  const busyRetry = busy || active.length > 0;
  const queueRunning = settings.enabled && settings.prewarm_enabled;

  const tabCount = filter === "all"
    ? counts.pending + counts.processing + counts.success + counts.failed
    : counts[filter];
  const totalPages = perPage === "all" ? 1 : Math.max(1, Math.ceil(tabCount / perPage));

  async function load(f = filter, p = page, per = perPage) {
    const q = new URLSearchParams();
    if (per === "all") q.set("limit", "all");
    else { q.set("limit", String(per)); q.set("offset", String((p - 1) * per)); }
    if (f !== "all") q.set("status", f);
    const r = await fetch(`/api/prewarm/queue?${q.toString()}`);
    const j = await r.json();
    if (!j.error) { setRows(j.items); setCounts(j.counts); }
  }

  async function loadSettings() {
    try {
      const r = await fetch("/api/settings");
      const j = await r.json();
      if (!j.error) setSettings({
        enabled: !!j.enabled,
        prewarm_enabled: j.prewarm_enabled !== false,
        prewarm_tasks_per_tick: j.prewarm_tasks_per_tick ?? 10,
      });
    } catch { /* ignore */ }
  }

  async function setPrewarm(on: boolean) {
    if (!on) stopRef.current = true;
    else stopRef.current = false;
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prewarm_enabled: on }),
      });
      const j = await r.json();
      if (!j.error) setSettings({
        enabled: !!j.enabled,
        prewarm_enabled: j.prewarm_enabled !== false,
        prewarm_tasks_per_tick: j.prewarm_tasks_per_tick ?? 10,
      });
    } catch { /* ignore */ }
  }

  async function saveTasksPerTick(n: number) {
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prewarm_tasks_per_tick: n }),
      });
      const j = await r.json();
      if (!j.error) setSettings({
        enabled: !!j.enabled,
        prewarm_enabled: j.prewarm_enabled !== false,
        prewarm_tasks_per_tick: j.prewarm_tasks_per_tick ?? n,
      });
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load("all", 1, perPage);
    loadSettings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While this queue runs on the server this page is a monitor — refresh as it works.
  useEffect(() => {
    if (!queueRunning) return;
    const t = setInterval(() => { load(); loadSettings(); }, 10000);
    return () => clearInterval(t);
  }, [queueRunning, filter, page, perPage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSitemap() {
    if (!sitemap.trim() || loading) return;
    setLoading(true);
    setLast("");
    try {
      const r = await fetch("/api/prewarm/load", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitemapUrl: sitemap.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `load ${r.status}`);
      setLast(`discovered ${j.discovered}, new ${j.inserted}`);
      setCounts(j.counts);
      setFilter("all"); setPage(1); load("all", 1, perPage);
    } catch (e) {
      setLast(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  async function patch(url: string, body: object) {
    await fetch("/api/prewarm/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...body }),
    });
  }

  // Browser-driven single visit: visit -> mark. HTTP <400 = success.
  async function processOne(q: PRow) {
    setActive((a) => (a.includes(q.source_url) ? a : [...a, q.source_url]));
    try {
      await patch(q.source_url, { status: "processing", failReason: null });
      const v = await fetch("/api/prewarm/visit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: q.source_url }),
      });
      const vj = await v.json();
      if (!v.ok) throw new Error(vj.error || `visit ${v.status}`);
      await patch(q.source_url, vj.ok
        ? { status: "success", httpCode: vj.code, durationMs: vj.durationMs, failReason: null }
        : { status: "failed", httpCode: vj.code, durationMs: vj.durationMs, failReason: `http ${vj.code}` });
      return !!vj.ok;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await patch(q.source_url, { status: "failed", failReason: msg.slice(0, 300) });
      return false;
    } finally {
      setActive((a) => a.filter((u) => u !== q.source_url));
    }
  }

  // Bulk browser retry of failed rows (claimed synchronously so cron can't steal them).
  async function retryFailed() {
    if (busyRetry || counts.failed === 0) return;
    setBusy(true);
    stopRef.current = false;
    setLast("");
    setDone(0);
    await fetch("/api/prewarm/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    const r = await fetch("/api/prewarm/queue?status=processing&limit=1000");
    const j = await r.json();
    const items: PRow[] = (j.items ?? []).filter((it: PRow) => !active.includes(it.source_url));
    let cursor = 0, ok = 0, fail = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, items.length) }, async () => {
        while (true) {
          if (stopRef.current) return;
          const i = cursor++;
          if (i >= items.length) return;
          if (await processOne(items[i])) ok++; else fail++;
          setDone(ok + fail);
          load();
        }
      })
    );
    setBusy(false);
    setLast(stopRef.current ? `stopped: ok ${ok}, failed ${fail}` : `retried: ok ${ok}, failed ${fail}`);
    load();
  }

  async function moveToPending() {
    if (busyRetry || counts.failed === 0) return;
    const r = await fetch("/api/prewarm/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "to-pending" }),
    });
    const j = await r.json();
    setLast(`moved ${j.reset ?? 0} failed → pending (cron picks them up)`);
    load();
  }

  async function clearAll() {
    if (busyRetry) return;
    if (!window.confirm("Clear the entire pre-warm queue history?")) return;
    const r = await fetch("/api/prewarm/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    const j = await r.json();
    setLast(`cleared ${j.cleared ?? 0} rows`);
    setFilter("all"); setPage(1); load("all", 1, perPage);
  }

  async function retryOne(url: string) {
    if (busy) return;
    const row = rows.find((q) => q.source_url === url);
    if (!row || active.includes(url)) return;
    if (row.status !== "failed" && row.status !== "success") return;
    await processOne({ ...row });
    load();
  }

  const pill: Record<PRow["status"], string> = {
    pending: "bg-surface-alt text-text-muted",
    processing: "bg-primary/15 text-primary-dark",
    success: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-bold text-text-primary">Pre-warm queue</h1>
      <p className="mt-1 text-sm text-text-secondary">
        ISR cache warming — load a sitemap, then visit every page so caches generate. Server cron processes it; Retry runs instantly here.
      </p>

      <div className="mt-4">
        <QueueSwitch
          on={settings.prewarm_enabled}
          onToggle={() => setPrewarm(!settings.prewarm_enabled)}
          title={`Pre-warm queue ${settings.prewarm_enabled ? "on" : "off"}`}
          hint={!settings.enabled ? "Needs Processor active in Settings to run" : settings.prewarm_enabled ? "Cron visits pages" : "Pre-warm skipped by cron"}
        >
          <TasksPerTickInput value={settings.prewarm_tasks_per_tick} onChange={saveTasksPerTick} />
        </QueueSwitch>
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Sitemap URL</label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={sitemap}
            onChange={(e) => setSitemap(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadSitemap(); }}
            placeholder="https://example.com/sitemap.xml"
            className="flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2.5 font-mono text-xs text-text-primary outline-none focus:border-primary"
          />
          <button onClick={loadSitemap} disabled={!sitemap.trim() || loading}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-40">
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => load()} className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary">Refresh</button>
          <button onClick={retryFailed} disabled={busyRetry || counts.failed === 0}
            className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary disabled:opacity-40">
            Retry failed ({counts.failed})</button>
          <button onClick={moveToPending} disabled={busyRetry || counts.failed === 0}
            title="Move failed rows back to pending so server cron picks them up"
            className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary disabled:opacity-40">
            → Pending ({counts.failed})</button>
          <button onClick={clearAll} disabled={busyRetry || tabCount === 0}
            className="rounded-lg border border-danger/50 px-2.5 py-1 text-danger hover:border-danger disabled:opacity-40">
            Clear</button>
          {last && <span className="text-text-secondary">{last}</span>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {(["pending", "processing", "success", "failed"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface px-2 py-2.5">
            <p className="text-lg font-bold text-text-primary">{counts[s]}</p>
            <p className="text-[11px] capitalize text-text-secondary">{s}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
        {(["all", "pending", "processing", "success", "failed"] as const).map((f) => {
          const n = f === "all" ? counts.pending + counts.processing + counts.success + counts.failed : counts[f];
          return (
            <button key={f} onClick={() => { setFilter(f); setPage(1); load(f, 1, perPage); }}
              className={`flex-1 rounded-lg px-3 py-2 font-medium capitalize transition ${
                filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}>{f} ({n})</button>
          );
        })}
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((q) => (
          <div key={q.id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={q.source_url}>{q.source_url}</span>
              <a href={q.source_url} target="_blank" rel="noopener noreferrer" title="Open page"
                className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:border-primary hover:text-text-primary">↗</a>
              {q.http_code != null && (
                <span className="rounded-md bg-surface-alt px-2 py-1 font-mono text-[11px] text-text-secondary">
                  {q.http_code}{q.duration_ms != null ? ` · ${(q.duration_ms / 1000).toFixed(1)}s` : ""}
                </span>
              )}
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill[q.status]}`}>{q.status}</span>
              {(q.status === "failed" || q.status === "success") && (
                <button onClick={() => retryOne(q.source_url)} disabled={busy || active.includes(q.source_url)}
                  className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:border-primary disabled:opacity-40">
                  {active.includes(q.source_url) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                  ↻ Retry</button>
              )}
            </div>
            {q.status === "failed" && q.fail_reason && (
              <p className="mt-1 font-mono text-[11px] text-danger">{q.fail_reason}</p>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">No URLs yet — load a sitemap above.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm">
        {perPage !== "all" && (
          <>
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(filter, p, perPage); }}
              disabled={page <= 1} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">← Prev</button>
            <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
            <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); load(filter, p, perPage); }}
              disabled={page >= totalPages} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">Next →</button>
          </>
        )}
        {perPage === "all" && <span className="text-xs text-text-secondary">{rows.length} rows</span>}
        <select value={String(perPage)} onChange={(e) => {
            const v = e.target.value === "all" ? "all" as const : Number(e.target.value);
            setPerPage(v); setPage(1); load(filter, 1, v);
          }}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary">
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          <option value="all">All</option>
        </select>
      </div>
    </main>
  );
}
