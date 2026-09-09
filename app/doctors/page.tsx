"use client";

import { useEffect, useRef, useState } from "react";

type DRow = {
  id: number; source_url: string; name: string | null;
  specialty_slug: string; specialty_slugs: string[]; department_ids: string[];
  card_text: string | null;  status: "pending" | "processing" | "success" | "failed";
  drx_id: string | null; fail_reason: string | null;
};

const SPECIALTIES = ["anesthesiologist","oncologist","cardiac-surgeon","cardiologist","chest-specialist","pediatrician","colorectal-surgeon","dentist","endocrinologist","otolaryngologist","homeopathic","ophthalmologist","gastroenterologist","general-surgeon","gynecologist","hematologist","infertility-specialist","nephrologist","hepatologist","medicine-specialist","neurologist","neurosurgeon","orthopedic-specialist","pediatric-surgeon","physical-medicine-specialist","plastic-surgeon","psychiatrist","rheumatologist","sexologist","dermatologist","urologist","vascular-surgeon"];

export default function Doctors() {
  const [rows, setRows] = useState<DRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, success: 0, failed: 0 });
  const [filter, setFilter] = useState<"all" | "pending" | "success" | "failed">("all");
  const [specialty, setSpecialty] = useState("");
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | "all">(20);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState(10);
  const [last, setLast] = useState("");
  const [done, setDone] = useState(0);
  const stopRef = useRef(false);

  const tabCount = filter === "all"
    ? counts.pending + counts.processing + counts.success + counts.failed
    : counts[filter];
  const totalPages = perPage === "all" ? 1 : Math.max(1, Math.ceil(tabCount / perPage));

  async function load(sp = specialty, f = filter, p = page, per = perPage, c = city) {
    const q = new URLSearchParams();
    if (per === "all") q.set("limit", "all");
    else { q.set("limit", String(per)); q.set("offset", String((p - 1) * per)); }
    if (f !== "all") q.set("status", f);
    if (sp) q.set("specialty", sp);
    if (c) q.set("city", c);
    const r = await fetch(`/api/doctors/queue?${q.toString()}`);
    const j = await r.json();
    if (!j.error) { setRows(j.items); setCounts(j.counts); }
  }

  useEffect(() => {
    load("", "all", 1, perPage, "");
    fetch("/api/doctors/cities").then((r) => r.json()).then((j) => {
      if (j.cities?.length) setCities(j.cities);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(url: string, body: object) {
    await fetch("/api/doctors/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...body }),
    });
  }

  // Browser-driven single-item pipeline: fetch -> extract -> drx -> mark.
  // Each step is its own short request (serverless-safe); 2 workers in this tab.
  async function processOne(q: DRow) {
    try {
      await patch(q.source_url, { status: "processing", failReason: null });
      const f = await fetch("/api/doctors/fetch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: q.source_url }),
      });
      const fj = await f.json();
      if (!f.ok) throw new Error(fj.error || `fetch ${f.status}`);

      const e = await fetch("/api/doctors/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: fj.markdown, specialty: q.specialty_slug, card: q.card_text }),
      });
      const ej = await e.json();
      if (!e.ok) throw new Error(ej.error || `extract ${e.status}`);

      const d = await fetch("/api/doctors/drx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor: ej.doctor, departmentIds: q.department_ids,
          sourceUrl: q.source_url, drxId: q.drx_id ?? undefined,
        }),
      });
      const dj = await d.json();
      if (!d.ok) throw new Error(dj.error || `drx ${d.status}`);

      await patch(q.source_url, { status: "success", name: ej.doctor.name, drxId: dj.drxId, failReason: null });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await patch(q.source_url, { status: "failed", failReason: msg.slice(0, 300) });
      return false;
    }
  }

  async function processNext() {
    if (busy) return;
    setBusy(true);
    stopRef.current = false;
    setLast("");
    setDone(0);
    try {
      const r = await fetch(`/api/doctors/queue?status=pending&limit=${batch}`);
      const j = await r.json();
      const rows: DRow[] = j.items ?? [];
      if (!rows.length) { setLast("nothing pending"); setBusy(false); return; }
      let cursor = 0, ok = 0, fail = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, rows.length) }, async () => {
          while (true) {
            if (stopRef.current) return;
            const i = cursor++;
            if (i >= rows.length) return;
            if (await processOne(rows[i])) ok++; else fail++;
            setDone(ok + fail);
            load();
          }
        })
      );
      setLast(stopRef.current ? `stopped: ok ${ok}, failed ${fail}` : `ok ${ok}, failed ${fail}`);
    } catch (e) {
      setLast(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
    load();
  }

  async function retryFailed() {
    if (busy || counts.failed === 0) return;
    setBusy(true);
    await fetch("/api/doctors/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", statuses: ["failed"] }),
    });
    setBusy(false);
    setLast(`reset ${counts.failed} failed to pending — hit Process to run them`);
    load();
  }

  async function retryOne(url: string) {
    if (busy) return;
    await fetch("/api/doctors/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, status: "pending", failReason: null }),
    });
    load();
  }

  const pill: Record<DRow["status"], string> = {
    pending: "bg-surface-alt text-text-muted",
    processing: "bg-primary/15 text-primary-dark",
    success: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-bold text-text-primary">Doctors queue</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Sylhet pilot — profile → extract → DRX doctor + degrees. Chambers land in extraInformation until the backend adds a doctor link.
      </p>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {(["pending", "processing", "success", "failed"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface px-2 py-2.5">
            <p className="text-lg font-bold text-text-primary">{counts[s]}</p>
            <p className="text-[11px] capitalize text-text-secondary">{s}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">City group</label>
        <div className="mt-1.5 flex gap-2">
          <select
            className="flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm capitalize text-text-primary outline-none focus:border-primary"
            value={city} onChange={(e) => { setCity(e.target.value); setPage(1); load(specialty, filter, 1, perPage, e.target.value); }}
          >
            <option value="">All cities ({cities.reduce((n, c) => n + c.count, 0)})</option>
            {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.count})</option>)}
          </select>
        </div>
        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-text-secondary">Specialty</label>
        <div className="mt-1.5 flex gap-2">
          <select
            className="flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
            value={specialty} onChange={(e) => { setSpecialty(e.target.value); setPage(1); load(e.target.value, filter, 1, perPage); }}
          >
            <option value="">All specialties ({counts.pending + counts.processing + counts.success + counts.failed})</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={batch} onChange={(e) => setBatch(Number(e.target.value))}
            className="rounded-xl border border-border bg-surface-alt px-2 py-2.5 text-sm text-text-primary outline-none focus:border-primary">
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / run</option>)}
          </select>
          {!busy ? (
            <button onClick={processNext} disabled={counts.pending === 0}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-40">
              Process
            </button>
          ) : (
            <button onClick={() => { stopRef.current = true; }}
              className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white">
              Stop{done > 0 ? ` (${done})` : ""}
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => load()} className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary">Refresh</button>
          <button onClick={retryFailed} disabled={busy || counts.failed === 0}
            className="rounded-lg border border-border px-2.5 py-1 text-text-secondary hover:border-primary disabled:opacity-40">
            Retry failed ({counts.failed})</button>
          {last && <span className="text-text-secondary">{last}</span>}
        </div>
      </div>

      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
        {(["all", "pending", "success", "failed"] as const).map((f) => {
          const n = f === "all" ? counts.pending + counts.processing + counts.success + counts.failed : counts[f];
          return (
            <button key={f} onClick={() => { setFilter(f); setPage(1); load(specialty, f, 1, perPage); }}
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
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{q.name}</span>
              <span className="rounded-md bg-surface-alt px-2 py-1 text-[11px] text-text-secondary">{q.specialty_slug}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill[q.status]}`}>{q.status}</span>
              {q.drx_id != null && (
                <span className="rounded-md bg-success/15 px-2 py-1 font-mono text-[11px] font-bold text-success">DRX #{q.drx_id}</span>
              )}
              {(q.status === "failed" || q.status === "success") && (
                <button onClick={() => retryOne(q.source_url)} disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:border-primary disabled:opacity-40">↻ Retry</button>
              )}
            </div>
            {q.status === "failed" && q.fail_reason && (
              <p className="mt-1 font-mono text-[11px] text-danger">{q.fail_reason}</p>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">No doctors in this view yet.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm">
        {perPage !== "all" && (
          <>
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(specialty, filter, p, perPage); }}
              disabled={page <= 1} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">← Prev</button>
            <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
            <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); load(specialty, filter, p, perPage); }}
              disabled={page >= totalPages} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40">Next →</button>
          </>
        )}
        {perPage === "all" && <span className="text-xs text-text-secondary">{rows.length} rows</span>}
        <select value={String(perPage)} onChange={(e) => {
            const v = e.target.value === "all" ? "all" as const : Number(e.target.value);
            setPerPage(v); setPage(1); load(specialty, filter, 1, v);
          }}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary">
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          <option value="all">All</option>
        </select>
      </div>
    </main>
  );
}
