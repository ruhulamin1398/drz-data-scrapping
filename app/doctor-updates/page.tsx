"use client";

import { useEffect, useState } from "react";
import QueueSwitch, { TasksPerTickInput } from "@/components/QueueSwitch";

type Run = {
  id: number; doctor_queue_id: number; doctor_name: string | null;
  drx_id: string | null; source_url: string; type: "photo" | "experience";
  status: "pending" | "processing" | "success" | "failed" | "skipped";
  options: { skipIfPhotoExists?: boolean; skipIfExperienceSet?: boolean };
  result: "updated" | "skipped" | "failed" | null;
  prev_photo: string | null; new_photo: string | null;
  fail_reason: string | null; note: string | null;
  finished_at: string | null;
};

type Cand = { id: number; name: string | null; source_url: string; drx_id: string | null; specialty_slug: string | null };

export default function DoctorUpdates() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, success: 0, failed: 0, skipped: 0 });
  const [filter, setFilter] = useState<"all" | "pending" | "processing" | "success" | "failed" | "skipped">("all");
  const [cands, setCands] = useState<Cand[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [utility, setUtility] = useState<"photo" | "experience">("photo");
  const [skip, setSkip] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<number[]>([]);
  const [settings, setSettings] = useState({ enabled: false, doctor_updates_enabled: true, doctor_updates_tasks_per_tick: 10 });
  const [viewId, setViewId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [skipDraft, setSkipDraft] = useState(true);
  const queueRunning = settings.enabled && settings.doctor_updates_enabled;

  async function loadRuns(f = filter) {
    const q = new URLSearchParams({ limit: "100" });
    if (f !== "all") q.set("status", f);
    const r = await fetch(`/api/doctors/updates?${q.toString()}`);
    const j = await r.json();
    if (!j.error) { setRuns(j.items); setCounts(j.counts); }
    else setMsg(j.error);
  }

  async function loadCands() {
    const r = await fetch(`/api/doctors/queue?status=success&limit=100`);
    const j = await r.json();
    if (!j.error) setCands((j.items ?? []).filter((x: Cand) => x.drx_id));
  }

  useEffect(() => { loadRuns("all"); loadCands(); loadSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSettings() {
    try {
      const r = await fetch("/api/settings");
      const j = await r.json();
      if (!j.error) setSettings({ enabled: !!j.enabled, doctor_updates_enabled: j.doctor_updates_enabled !== false, doctor_updates_tasks_per_tick: j.doctor_updates_tasks_per_tick ?? 10 });
    } catch { /* ignore */ }
  }

  async function saveTasksPerTick(n: number) {
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_updates_tasks_per_tick: n }),
      });
      const j = await r.json();
      if (!j.error) setSettings({ enabled: !!j.enabled, doctor_updates_enabled: j.doctor_updates_enabled !== false, doctor_updates_tasks_per_tick: j.doctor_updates_tasks_per_tick ?? n });
    } catch { /* ignore */ }
  }

  async function setUpdates(on: boolean) {
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_updates_enabled: on }),
      });
      const j = await r.json();
      if (!j.error) setSettings({ enabled: !!j.enabled, doctor_updates_enabled: j.doctor_updates_enabled !== false, doctor_updates_tasks_per_tick: j.doctor_updates_tasks_per_tick ?? 10 });
    } catch { /* ignore */ }
  }

  async function enqueueSelected() {
    if (!sel.length) return;
    setBusy(true); setMsg("");
    const options = utility === "experience"
      ? { skipIfExperienceSet: skip }
      : { skipIfPhotoExists: skip };
    const r = await fetch("/api/doctors/updates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorQueueIds: sel, type: utility, options }),
    });
    const j = await r.json();
    setBusy(false);
    setMsg(r.ok ? `enqueued ${j.enqueued}, already-active ${j.skippedActive}` : j.error);
    setSel([]);
    loadRuns();
  }

  async function enqueueAllPushed() {
    setBusy(true); setMsg("");
    const options = utility === "experience"
      ? { skipIfExperienceSet: skip }
      : { skipIfPhotoExists: skip };
    const r = await fetch("/api/doctors/updates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bulk: { status: "success", limit: 500 }, type: utility, options }),
    });
    const j = await r.json();
    setBusy(false);
    setMsg(r.ok ? `enqueued ${j.enqueued}, already-active ${j.skippedActive}` : j.error);
    loadRuns();
  }

  async function runNow(id: number) {
    setRunning((a) => [...a, id]);
    const r = await fetch(`/api/doctors/updates/${id}/run`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setRunning((a) => a.filter((x) => x !== id));
    setMsg(r.ok ? `run #${id}: ${j.result}` : `run #${id} failed: ${j.error}`);
    loadRuns();
  }

  async function retryHistory(id: number) {
    const r = await fetch(`/api/doctors/updates/${id}/retry`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `re-enqueued as #${j.id}` : j.error ?? j.reason);
    loadRuns();
  }

  function startEdit(r: Run) {
    setViewId(null);
    setEditId(r.id);
    setNoteDraft(r.note ?? "");
    setSkipDraft(r.type === "experience"
      ? (r.options?.skipIfExperienceSet !== false)
      : (r.options?.skipIfPhotoExists !== false));
  }

  async function saveEdit(r: Run) {
    const body: { note?: string; skipIfPhotoExists?: boolean; skipIfExperienceSet?: boolean } = {};
    if (noteDraft !== (r.note ?? "")) body.note = noteDraft;
    if (r.status === "pending") {
      if (r.type === "experience" && skipDraft !== (r.options?.skipIfExperienceSet !== false)) body.skipIfExperienceSet = skipDraft;
      if (r.type === "photo" && skipDraft !== (r.options?.skipIfPhotoExists !== false)) body.skipIfPhotoExists = skipDraft;
    }
    if (!Object.keys(body).length) { setEditId(null); return; }
    const res = await fetch(`/api/doctors/updates/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? `saved #${r.id}` : j.error);
    setEditId(null);
    loadRuns();
  }

  async function delRun(id: number) {
    if (!confirm(`Delete update run #${id}? History for this run is removed.`)) return;
    const res = await fetch(`/api/doctors/updates/${id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? `deleted #${id}` : j.error);
    if (viewId === id) setViewId(null);
    loadRuns();
  }

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // While this queue runs on the server this page is a monitor — refresh as it works.
  useEffect(() => {
    if (!queueRunning) return;
    const t = setInterval(() => { loadRuns(); loadSettings(); }, 10000);
    return () => clearInterval(t);
  }, [queueRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-bold text-text-primary">Doctor updates</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Independent queue. Pick utility + option, enqueue to pending, cron (Render) or Run-now processes. History kept per run.
      </p>

      <div className="mt-4">
        <QueueSwitch
          on={settings.doctor_updates_enabled}
          onToggle={() => setUpdates(!settings.doctor_updates_enabled)}
          title={`Doctor updates queue ${settings.doctor_updates_enabled ? "on" : "off"}`}
          hint={!settings.enabled ? "Needs Processor active in Settings to run" : settings.doctor_updates_enabled ? "Cron processes photo updates (Render)" : "Photo updates skipped by cron"}
        >
          <TasksPerTickInput value={settings.doctor_updates_tasks_per_tick} onChange={saveTasksPerTick} />
        </QueueSwitch>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Utility</label>
          <select value={utility} onChange={(e) => setUtility(e.target.value as "photo" | "experience")}
            className="rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm">
            <option value="photo">photo</option>
            <option value="experience">experience</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            {utility === "experience" ? "Skip if experience set" : "Skip if photo exists"}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button onClick={enqueueSelected} disabled={busy || !sel.length}
            className="rounded-lg border border-border px-2.5 py-1.5 text-text-primary disabled:opacity-40">
            Enqueue selected ({sel.length})
          </button>
          <button onClick={enqueueAllPushed} disabled={busy}
            className="rounded-lg border border-border px-2.5 py-1.5 text-text-secondary disabled:opacity-40">
            Enqueue all pushed (success)
          </button>
          <button onClick={() => { loadRuns(); loadCands(); }} className="rounded-lg border border-border px-2.5 py-1.5 text-text-secondary">Refresh</button>
          {msg && <span className="text-text-secondary">{msg}</span>}
        </div>
        <div className="mt-3 max-h-56 space-y-1 overflow-auto">
          {cands.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
              <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
              <span className="min-w-0 flex-1 truncate text-text-primary">{c.name ?? `#${c.id}`} <span className="text-text-secondary">({c.specialty_slug})</span></span>
              <span className="font-mono text-[11px] text-success">{String(c.drx_id).slice(0, 8)}</span>
            </label>
          ))}
          {!cands.length && <p className="text-sm text-text-secondary">No pushed doctors yet — push via /doctors first.</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 text-center">
        {(["pending", "processing", "success", "skipped", "failed"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface px-2 py-2.5">
            <p className="text-lg font-bold text-text-primary">{counts[s]}</p>
            <p className="text-[11px] capitalize text-text-secondary">{s}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
        {(["all", "pending", "processing", "success", "skipped", "failed"] as const).map((f) => (
          <button key={f} onClick={() => { setFilter(f); loadRuns(f); }}
            className={`flex-1 rounded-lg px-3 py-2 font-medium capitalize ${filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-text-secondary">#{r.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{r.doctor_name ?? `queue #${r.doctor_queue_id}`}</span>
              <a href={r.source_url} target="_blank" rel="noopener noreferrer" title="Open scraped source page"
                className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:border-primary hover:text-text-primary">↗</a>
              {r.drx_id && (
                <a href={`https://www.doctorzonebd.com/doctors/${r.drx_id}`} target="_blank" rel="noopener noreferrer" title="Open DoctorZone page to compare"
                  className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:border-primary hover:text-text-primary">DZ ↗</a>
              )}
              <span className="rounded-md bg-surface-alt px-2 py-0.5 text-[11px]">{r.type}</span>
              <span className="rounded-full bg-surface-alt px-2.5 py-1 text-[11px] font-semibold">{r.status}{r.result ? `/${r.result}` : ""}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {r.drx_id ? (
                <a href={`https://www.doctorzonebd.com/doctors/${r.drx_id}`} target="_blank" rel="noopener noreferrer" title={r.drx_id}
                  className="rounded-md bg-success/15 px-2 py-1 font-mono text-[11px] font-bold text-success hover:underline">
                  DRX #{r.drx_id.slice(0, 8)}
                </a>
              ) : (
                <span className="rounded-md bg-surface-alt px-2 py-1 font-mono text-[11px] text-text-muted">no DRX id</span>
              )}
              <span className="font-mono text-[11px] text-text-muted">queue #{r.doctor_queue_id}</span>
              <span className="ml-auto flex gap-1">
                <button onClick={() => runNow(r.id)} disabled={running.includes(r.id) || r.status === "processing"}
                  title="Run this update now in this tab"
                  className="rounded-lg border border-border px-2 py-1 font-medium text-text-secondary hover:border-primary disabled:opacity-40">▶ Run</button>
                <button onClick={() => { setEditId(null); setViewId(viewId === r.id ? null : r.id); }}
                  className="rounded-lg border border-border px-2 py-1 font-medium text-text-secondary hover:border-primary">View</button>
                <button onClick={() => (editId === r.id ? setEditId(null) : startEdit(r))}
                  className="rounded-lg border border-border px-2 py-1 font-medium text-text-secondary hover:border-primary">Edit</button>
                <button onClick={() => delRun(r.id)} disabled={r.status === "processing"}
                  className="rounded-lg border border-border px-2 py-1 font-medium text-danger hover:border-danger disabled:opacity-40">Delete</button>
                {(r.status === "failed" || r.status === "success" || r.status === "skipped") && (
                  <button onClick={() => retryHistory(r.id)}
                    className="rounded-lg border border-border px-2 py-1 font-medium text-text-secondary hover:border-primary">↻ Re-enqueue</button>
                )}
              </span>
            </div>
            {r.note && editId !== r.id && (
              <p className="mt-1.5 truncate text-xs text-text-secondary" title={r.note}>📝 {r.note}</p>
            )}
            {r.fail_reason && r.status === "failed" && (
              <p className="mt-1 font-mono text-[11px] text-danger">{r.fail_reason}</p>
            )}
            {viewId === r.id && (
              <div className="mt-2 rounded-xl bg-surface-alt p-3 text-xs">
                {r.type === "experience" ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-text-secondary">
                    <dt>before</dt><dd className="text-text-primary">{r.note?.includes("experience") ? r.note.split("experience ")[1]?.split(" → ")[0] || "—" : "—"}</dd>
                    <dt>after</dt><dd className="text-text-primary">{r.note?.includes("→") ? r.note.split("→ ")[1]?.split(" years")[0] + " years" : "—"}</dd>
                    <dt>result</dt><dd className="text-text-primary">{r.result ?? "—"}</dd>
                    <dt>finished</dt><dd className="text-text-primary">{r.finished_at ?? "—"}</dd>
                    <dt>source</dt><dd className="break-all">{r.source_url}</dd>
                  </dl>
                ) : (
                  <>
                    <div className="flex gap-3">
                      {r.prev_photo && (
                        <div className="flex-1">
                          <p className="mb-1 font-semibold uppercase tracking-wide text-text-secondary">Before</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.prev_photo} alt="previous photo" className="h-24 w-24 rounded-lg border border-border object-cover" />
                          <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{r.prev_photo}</p>
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="mb-1 font-semibold uppercase tracking-wide text-text-secondary">{r.new_photo ? "After" : "Photo"}</p>
                        {r.new_photo ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.new_photo} alt="new photo" className="h-24 w-24 rounded-lg border border-border object-cover" />
                            <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{r.new_photo}</p>
                          </>
                        ) : (
                          <p className="text-text-secondary">{r.prev_photo ? "unchanged (skipped)" : "no photo resolved"}</p>
                        )}
                      </div>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-text-secondary">
                      <dt>skipIfExists</dt><dd className="text-text-primary">{r.options?.skipIfPhotoExists === false ? "off (force)" : "on"}</dd>
                      <dt>result</dt><dd className="text-text-primary">{r.result ?? "—"}</dd>
                      <dt>finished</dt><dd className="text-text-primary">{r.finished_at ?? "—"}</dd>
                      <dt>source</dt><dd className="break-all">{r.source_url}</dd>
                    </dl>
                  </>
                )}
                {r.note && <p className="mt-2 text-text-primary">📝 {r.note}</p>}
                {r.fail_reason && <p className="mt-1 font-mono text-[11px] text-danger">{r.fail_reason}</p>}
              </div>
            )}
            {editId === r.id && (
              <div className="mt-2 rounded-xl bg-surface-alt p-3 text-xs">
                <label className="block font-semibold uppercase tracking-wide text-text-secondary">Note</label>
                <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={2} maxLength={1000}
                  placeholder="What was there before, what changed, other remarks…"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary" />
                {r.status === "pending" && (
                  <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
                    <input type="checkbox" checked={skipDraft} onChange={(e) => setSkipDraft(e.target.checked)} />
                    {r.type === "experience" ? "Skip if experience set" : "Skip if photo exists"}
                  </label>
                )}
                <div className="mt-2 flex gap-2">
                  <button onClick={() => saveEdit(r)} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Save</button>
                  <button onClick={() => setEditId(null)} className="rounded-lg border border-border px-3 py-1.5 text-text-secondary">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!runs.length && <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">No update runs yet.</p>}
      </div>
    </main>
  );
}
