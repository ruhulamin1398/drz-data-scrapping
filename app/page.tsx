"use client";

import { useEffect, useRef, useState } from "react";
import { parseExtracted } from "@/lib/parse";

type Group = {
  key: string; division: string; divisionId: number;
  district?: string; districtId?: number;
  items: { title: string; url: string }[];
};

type QRow = {
  id: number; title: string; source_url: string;
  division_id: number; district_id: number | null; type_id: number;
  group_key: string | null;
  status: "pending" | "processing" | "success" | "failed";
  name: string | null; full_address: string | null;
  drx_id: number | null; fail_reason: string | null;
};

type DoneStatus = "failed" | "success";
type Settings = { enabled: boolean; concurrency: number; tasks_per_tick: number; heartbeat_at: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const groupLabel = (g: Group) => `${g.division}${g.district ? ` — ${g.district}` : ""} (${g.items.length})`;

export default function Home() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupKey, setGroupKey] = useState("");
  const [queue, setQueue] = useState<QRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, success: 0, failed: 0 });
  const [filter, setFilter] = useState<"all" | "pending" | "success" | "failed">("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [settings, setSettings] = useState<Settings>({ enabled: false, concurrency: 3, tasks_per_tick: 10, heartbeat_at: null });
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string[]>([]); // urls the browser is retrying right now
  const stopRef = useRef(false);

  const isAll = groupKey === "all" || groupKey === "";
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const tabCount = filter === "all"
    ? counts.pending + counts.processing + counts.success + counts.failed
    : counts[filter];
  const totalPages = Math.max(1, Math.ceil(tabCount / perPage));
  const busyRetry = busy || active.length > 0;

  const scopeParam = (gk = groupKey) => (gk && gk !== "all" ? `&group=${encodeURIComponent(gk)}` : "");

  async function loadQueue(gk = groupKey, f = filter, p = page, per = perPage) {
    const statusParam = f === "all" ? "" : `&status=${f}`;
    const r = await fetch(`/api/queue?limit=${per}&offset=${(p - 1) * per}${statusParam}${scopeParam(gk)}`);
    const j = await r.json();
    if (!j.error) { setQueue(j.items); setCounts(j.counts); }
  }

  async function loadSettings() {
    try {
      const r = await fetch("/api/settings");
      const j = await r.json();
      if (!j.error) setSettings(j);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/groups");
      const j = await r.json();
      if (j.groups?.length) {
        setGroups(j.groups);
        const key = j.groups.find((g: Group) => g.divisionId === 41)?.key || j.groups[0].key;
        setGroupKey(key);
        await fetch("/api/queue/sync", { method: "POST" }); // everything in queue by default
        loadQueue(key);
      }
      loadSettings();
    })();
  }, []);
  useEffect(() => { if (groupKey) { setPage(1); loadQueue(groupKey, filter, 1, perPage); } }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page > totalPages) { setPage(totalPages); loadQueue(groupKey, filter, totalPages, perPage); }
  }, [totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while the server processor is enabled — the page is a monitor, no tab work needed.
  useEffect(() => {
    if (!settings.enabled) return;
    const t = setInterval(() => { loadQueue(); loadSettings(); }, 10000);
    return () => clearInterval(t);
  }, [settings.enabled, groupKey, filter, page, perPage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(url: string, body: object) {
    await fetch("/api/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...body }),
    });
  }

  async function saveSettings(patchBody: Partial<Settings>) {
    const r = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    const j = await r.json();
    if (!j.error) setSettings(j);
  }

  // Start = enable server processing (cron picks it up within a minute).
  // Stop = disable; in-flight server items finish, next tick goes quiet.
  async function setEnabled(enabled: boolean) {
    if (enabled) stopRef.current = false;
    else stopRef.current = true; // also halts any browser retry loop
    await saveSettings({ enabled });
  }

  // Browser-driven single-item processing (manual retry only — never cron's job).
  async function processOne(q: QRow, full: boolean) {
    setActive((a) => (a.includes(q.source_url) ? a : [...a, q.source_url]));
    try {
      const f = await fetch("/api/fetch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: q.source_url, full }),
      });
      const fj = await f.json();
      if (!f.ok) throw new Error(fj.error || `fetch ${f.status}`);

      const e = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimmed: fj.trimmed, divisionId: q.division_id }),
      });
      const ej = await e.json();
      if (!e.ok) throw new Error(ej.error || `extract ${e.status}`);

      const p = parseExtracted(ej.extracted || "");
      if (!p.fullAddress) {
        await patch(q.source_url, { status: "failed", name: p.name || null, failReason: "fullAddress empty from model" });
        return;
      }
      const divisionId = p.divisionId || q.division_id;
      const districtId = p.districtId || q.district_id;
      if (!districtId) {
        await patch(q.source_url, { status: "failed", name: p.name, fullAddress: p.fullAddress, failReason: "districtId unknown" });
        return;
      }
      const d = await fetch("/api/drx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name, divisionId, districtId, typeId: q.type_id,
          fullAddress: p.fullAddress, phones: p.phones, extraInformation: p.extraInformation,
          drxId: q.drx_id ?? undefined, // retry of a pushed row updates DRX in place
        }),
      });
      const dj = await d.json();
      if (!d.ok) throw new Error(dj.error || `drx ${d.status}`);

      await patch(q.source_url, {
        status: "success", name: p.name, fullAddress: p.fullAddress,
        phones: p.phones, extraInformation: p.extraInformation,
        divisionId, districtId, drxId: dj.drxId, failReason: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await patch(q.source_url, { status: "failed", failReason: msg.slice(0, 300) });
    } finally {
      setActive((a) => a.filter((u) => u !== q.source_url));
    }
  }

  // Bulk browser retry of failed rows in scope (all pages, full content, claimed
  // synchronously as processing so cron can't steal them).
  async function retryFailed() {
    if (busyRetry) return;
    const fr = await fetch(`/api/queue?status=failed&limit=1000${scopeParam()}`);
    const fj = await fr.json();
    const urls: string[] = (fj.items ?? []).map((it: QRow) => it.source_url);
    if (!urls.length) return;
    setBusy(true);
    await fetch("/api/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", statuses: ["failed"], toStatus: "processing", fullContent: true, ...(isAll ? {} : { group: groupKey }) }),
    });
    setBusy(false);
    await loadQueue();
    const r = await fetch(`/api/queue?limit=1000${scopeParam()}`);
    const j = await r.json();
    const rows: QRow[] = (j.items ?? []).filter((it: QRow) => urls.includes(it.source_url));
    const workers = Math.min(Math.max(1, Math.floor(settings.concurrency) || 1), 10);
    stopRef.current = false;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (true) {
          if (stopRef.current) return;
          const i = cursor++;
          if (i >= rows.length) return;
          await processOne(rows[i], true);
          loadQueue();
          await sleep(800);
        }
      })
    );
    loadQueue();
  }

  // Single-row browser retry (full content), independent of everything else.
  async function retryOne(url: string) {
    if (busy) return;
    const row = queue.find((q) => q.source_url === url);
    if (!row) return;
    if (row.status === "processing" && active.includes(url)) return; // genuinely being worked
    if (row.status !== "failed" && row.status !== "success" && row.status !== "processing") return;
    if (active.includes(url)) return;
    setActive((a) => [...a, url]);
    await patch(url, { status: "processing", failReason: null, fullContent: true } as object);
    await loadQueue();
    const r = await fetch(`/api/queue?limit=1000${scopeParam()}`);
    const j = await r.json();
    const fresh: QRow | undefined = (j.items ?? []).find((it: QRow) => it.source_url === url);
    if (fresh) await processOne(fresh, true);
    setActive((a) => a.filter((u) => u !== url));
    loadQueue();
  }

  const pill: Record<QRow["status"], string> = {
    pending: "bg-surface-alt text-text-muted",
    processing: "bg-primary/15 text-primary-dark",
    success: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };
  const showRetry = (q: QRow) =>
    q.status === "failed" || q.status === "success" ||
    (q.status === "processing" && !active.includes(q.source_url));

  const heartbeatAge = settings.heartbeat_at
    ? Math.max(0, Math.round((Date.now() - new Date(settings.heartbeat_at).getTime()) / 1000))
    : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-primary">Facilities queue</h1>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${settings.enabled ? "bg-success/15 text-success" : "bg-surface-alt text-text-muted"}`}>
          {settings.enabled ? (heartbeatAge != null && heartbeatAge < 180 ? `● live (${heartbeatAge}s ago)` : "● enabled") : "○ paused"}
        </span>
      </div>
      <p className="mt-1 text-sm text-text-secondary">
        Start runs the server processor via cron — no open browser needed. Concurrency lives in Settings. Retry stays manual, in this tab.
      </p>

      {/* counts */}
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {(["pending", "processing", "success", "failed"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface px-2 py-2.5">
            <p className="text-lg font-bold text-text-primary">{counts[s]}</p>
            <p className="text-[11px] capitalize text-text-secondary">{s}</p>
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Division group</label>
        <div className="mt-1.5 flex gap-2">
          <select
            className="flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
            value={isAll ? "all" : groupKey} onChange={(e) => setGroupKey(e.target.value)}
          >
            <option value="all">All groups ({totalItems})</option>
            {groups.map((g) => <option key={g.key} value={g.key}>{groupLabel(g)}</option>)}
          </select>
          {!settings.enabled ? (
            <button onClick={() => setEnabled(true)}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark">
              Start
            </button>
          ) : (
            <button onClick={() => setEnabled(false)}
              className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white">Stop</button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => { loadQueue(); loadSettings(); }} className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary">Refresh</button>
          <button onClick={retryFailed} disabled={busyRetry || counts.failed === 0}
            className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary disabled:opacity-40"
            title="Re-runs this group's failed rows here in the browser with full page content">
            Retry failed ({counts.failed})</button>
        </div>
      </div>

      {/* filter tabs with counts */}
      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
        {(["all", "pending", "success", "failed"] as const).map((f) => {
          const n = f === "all" ? counts.pending + counts.processing + counts.success + counts.failed : counts[f];
          return (
            <button key={f} onClick={() => { setFilter(f); setPage(1); loadQueue(groupKey, f, 1, perPage); }}
              className={`flex-1 rounded-lg px-3 py-2 font-medium capitalize transition ${
                filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}>{f} ({n})</button>
          );
        })}
      </div>

      {/* list */}
      <div className="mt-3 space-y-2">
        {queue.map((q) => (
          <div key={q.id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                {q.name || q.title}
              </span>
              {q.status === "processing" && !showRetry(q) && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill[q.status]}`}>{q.status}</span>
              {q.drx_id != null && (
                <span className="rounded-md bg-success/15 px-2 py-1 font-mono text-[11px] font-bold text-success">
                  DRX #{q.drx_id}
                </span>
              )}
              {showRetry(q) && (
                <button onClick={() => retryOne(q.source_url)} disabled={busy || active.includes(q.source_url)}
                  title="Retry this item here in the browser with the full page content"
                  className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary transition hover:border-primary hover:text-text-primary disabled:opacity-40">
                  {active.includes(q.source_url) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                  ↻ Retry
                </button>
              )}
            </div>
            {q.status === "failed" && q.fail_reason && (
              <p className="mt-1 font-mono text-[11px] text-danger">{q.fail_reason}</p>
            )}
            {q.status === "success" && q.full_address && (
              <p className="mt-1 truncate text-xs text-text-secondary">{q.full_address}</p>
            )}
          </div>
        ))}
        {queue.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
            No facilities in this view yet.
          </p>
        )}
      </div>

      {/* pagination */}
      <div className="mt-4 flex items-center justify-center gap-2 text-sm">
        <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadQueue(groupKey, filter, p, perPage); }}
          disabled={page <= 1}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">← Prev</button>
        <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
        <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); loadQueue(groupKey, filter, p, perPage); }}
          disabled={page >= totalPages}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">Next →</button>
        <select value={perPage} onChange={(e) => { const n = Number(e.target.value); setPerPage(n); setPage(1); loadQueue(groupKey, filter, 1, n); }}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary">
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </main>
  );
}
