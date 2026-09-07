"use client";

import { useEffect, useRef, useState } from "react";

type Group = {
  key: string; division: string; divisionId: number;
  district?: string; districtId?: number;
  items: { title: string; url: string }[];
};

type QRow = {
  id: number; title: string; source_url: string;
  division_id: number; district_id: number | null; type_id: number;
  status: "pending" | "processing" | "success" | "failed";
  name: string | null; full_address: string | null;
  drx_id: number | null; fail_reason: string | null;
};

function parseExtracted(text: string) {
  const get = (key: string) => {
    const m = text.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
    return (m?.[1] ?? "").trim();
  };
  let phones: string[] = [];
  try {
    const arr = JSON.parse(get("phones"));
    if (Array.isArray(arr)) phones = arr.map(String);
  } catch { /* leave empty */ }
  return {
    name: get("name"),
    fullAddress: get("fullAddress"),
    phones,
    extraInformation: get("extraInformation").replace(/^"|"$/g, ""),
    divisionId: Number(get("divisionId")) || 0,
    districtId: Number(get("districtId")) || 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const groupLabel = (g: Group) => `${g.division}${g.district ? ` — ${g.district}` : ""} (${g.items.length})`;

export default function Home() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupKey, setGroupKey] = useState("");
  const [queue, setQueue] = useState<QRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, success: 0, failed: 0 });
  const [filter, setFilter] = useState<"all" | "pending" | "success" | "failed">("all");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const stopRef = useRef(false);

  const group = groups.find((g) => g.key === groupKey);
  const shown = queue.filter((q) => filter === "all" || q.status === filter);

  async function loadGroups() {
    const r = await fetch("/api/groups");
    const j = await r.json();
    if (j.groups?.length) {
      setGroups(j.groups);
      setGroupKey((k) => k || j.groups.find((g: Group) => g.divisionId === 41)?.key || j.groups[0].key);
    }
  }

  async function loadQueue() {
    const r = await fetch("/api/queue?limit=1000");
    const j = await r.json();
    if (!j.error) { setQueue(j.items); setCounts(j.counts); }
  }

  useEffect(() => { loadGroups(); loadQueue(); }, []);

  // Step 1: seed whole group as pending
  async function addToQueue() {
    if (!group || busy) return;
    setBusy(true);
    await fetch("/api/queue/seed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: group.items, divisionId: group.divisionId, districtId: group.districtId ?? null }),
    });
    setBusy(false);
    loadQueue();
  }

  async function patch(url: string, body: object) {
    await fetch("/api/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...body }),
    });
  }

  // Step 2: process pending one by one → drx → success + drx id, or failed
  async function start() {
    if (running) return;
    const r = await fetch("/api/queue?status=pending&limit=1000");
    const j = await r.json();
    const pending: QRow[] = j.items ?? [];
    if (!pending.length) return;
    const workers = Math.min(Math.max(1, Math.floor(concurrency) || 1), 10);
    setRunning(true);
    stopRef.current = false;

    async function processOne(q: QRow) {
      await patch(q.source_url, { status: "processing" });
      try {
        const f = await fetch("/api/fetch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: q.source_url }),
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
      }
    }

    let cursor = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (true) {
          if (stopRef.current) return;
          const i = cursor++;
          if (i >= pending.length) return;
          await processOne(pending[i]);
          loadQueue();
          await sleep(800);
        }
      })
    );
    setRunning(false);
    loadQueue();
  }

  async function retryFailed() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry-failed" }) });
    setBusy(false);
    loadQueue();
  }

  const pill: Record<QRow["status"], string> = {
    pending: "bg-surface-alt text-text-muted",
    processing: "bg-primary/15 text-primary-dark",
    success: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-bold text-text-primary">Facilities queue</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Step 1: add a group as pending. Step 2: process one by one → DRX id stored on success.
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
            value={groupKey} onChange={(e) => setGroupKey(e.target.value)} disabled={running}
          >
            {groups.map((g) => <option key={g.key} value={g.key}>{groupLabel(g)}</option>)}
          </select>
          <button onClick={addToQueue} disabled={!group || busy || running}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-primary transition hover:border-primary disabled:opacity-40">
            Add to queue
          </button>
          {!running ? (
            <button onClick={start} disabled={counts.pending === 0}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-40">
              Start ({counts.pending})
            </button>
          ) : (
            <button onClick={() => { stopRef.current = true; }}
              className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white">Stop</button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-text-secondary">
            Concurrent
            <input type="number" min={1} max={10} value={concurrency} disabled={running}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-14 rounded-lg border border-border bg-surface-alt px-2 py-1 text-text-primary outline-none focus:border-primary disabled:opacity-40" />
          </label>
          <button onClick={loadQueue} className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary">Refresh</button>
          <button onClick={retryFailed} disabled={busy || counts.failed === 0}
            className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary disabled:opacity-40">
            Retry failed ({counts.failed})
          </button>
        </div>
      </div>

      {/* filter */}
      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
        {(["all", "pending", "success", "failed"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 rounded-lg px-3 py-2 font-medium capitalize transition ${
              filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}>{f}</button>
        ))}
      </div>

      {/* list */}
      <div className="mt-3 space-y-2">
        {shown.map((q) => (
          <div key={q.id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                {q.name || q.title}
              </span>
              {q.status === "processing" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill[q.status]}`}>{q.status}</span>
              {q.drx_id != null && (
                <span className="rounded-md bg-success/15 px-2 py-1 font-mono text-[11px] font-bold text-success">
                  DRX #{q.drx_id}
                </span>
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
        {shown.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
            Queue is empty — pick a group and Add to queue.
          </p>
        )}
      </div>
    </main>
  );
}
