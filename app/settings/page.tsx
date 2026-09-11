"use client";

import { useEffect, useState } from "react";

type Settings = {
  enabled: boolean; concurrency: number; tasks_per_tick: number; heartbeat_at: string | null;
  jina_keys_count?: number; jina_keys_masked?: string[];
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>({ enabled: false, concurrency: 3, tasks_per_tick: 10, heartbeat_at: null });
  const [saved, setSaved] = useState(false);
  const [keysText, setKeysText] = useState("");
  const [keysTouched, setKeysTouched] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/settings");
      const j = await r.json();
      if (!j.error) setS(j);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!s.enabled) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [s.enabled]);

  async function update(patch: Partial<Settings> & { jina_keys?: string }) {
    const r = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!j.error) {
      setS(j);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  const age = s.heartbeat_at
    ? Math.max(0, Math.round((Date.now() - new Date(s.heartbeat_at).getTime()) / 1000))
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-primary">Settings</h1>
        {saved && <span className="rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">✓ saved</span>}
      </div>
      <p className="mt-1 text-sm text-text-secondary">Processor configuration — read by every cron tick.</p>

      {/* processor switch */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">Processor {s.enabled ? "active" : "paused"}</p>
          <p className="text-xs text-text-secondary">
            {s.enabled
              ? age != null && age < 180 ? `Last tick ${age}s ago — cron is running` : "Enabled — waiting for next cron tick"
              : "Cron ticks do nothing while paused"}
          </p>
        </div>
        <button onClick={() => update({ enabled: !s.enabled })}
          className={`relative h-7 w-12 rounded-full transition ${s.enabled ? "bg-success" : "bg-border"}`}>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${s.enabled ? "left-6" : "left-1"}`} />
        </button>
      </div>

      {/* knobs */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="rounded-2xl border border-border bg-surface p-4 text-sm shadow-sm">
          <span className="font-semibold text-text-primary">Concurrency</span>
          <span className="mt-0.5 block text-xs text-text-secondary">Items processed at the same time (server safety)</span>
          <input type="number" min={1} max={10} value={s.concurrency}
            onChange={(e) => update({ concurrency: Number(e.target.value) })}
            className="mt-2 w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-text-primary outline-none focus:border-primary" />
        </label>
        <label className="rounded-2xl border border-border bg-surface p-4 text-sm shadow-sm">
          <span className="font-semibold text-text-primary">Tasks per tick</span>
          <span className="mt-0.5 block text-xs text-text-secondary">Each cron run tops up to this many active</span>
          <input type="number" min={1} max={50} value={s.tasks_per_tick}
            onChange={(e) => update({ tasks_per_tick: Number(e.target.value) })}
            className="mt-2 w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-text-primary outline-none focus:border-primary" />
        </label>
      </div>

      {/* cron info */}
      <div className="mt-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-sm">
        <p className="font-semibold text-text-primary">Cron endpoint</p>
        <p className="mt-1 font-mono text-xs text-text-secondary">POST /api/cron — header <span className="text-text-primary">x-cron-secret</span>, every 1 min via cron-job.org</p>
        <p className="mt-1 text-xs text-text-secondary">Tick history lives under <span className="font-semibold text-text-primary">History</span> in the sidebar.</p>
      </div>

      {/* jina keys */}
      <div className="mt-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-sm">
        <p className="font-semibold text-text-primary">
          Jina API keys {s.jina_keys_count != null && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{s.jina_keys_count} active</span>}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">One per line. Rotation is automatic: 429 rate-limit moves to the next key, dead keys are skipped. Used by every fetch instead of env.</p>
        {s.jina_keys_masked && s.jina_keys_masked.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.jina_keys_masked.map((k) => (
              <span key={k} className="rounded-full bg-surface-alt px-2.5 py-1 font-mono text-[11px] text-text-secondary">{k}</span>
            ))}
          </div>
        )}
        <textarea rows={3} placeholder="jina_... (one key per line) — paste to replace all"
          value={keysTouched ? keysText : ""}
          onChange={(e) => { setKeysText(e.target.value); setKeysTouched(true); }}
          className="mt-2 w-full rounded-xl border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-primary" />
        <button disabled={!keysTouched || !keysText.trim()}
          onClick={() => { update({ jina_keys: keysText }); setKeysText(""); setKeysTouched(false); }}
          className="mt-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Save keys
        </button>
      </div>
    </main>
  );
}
