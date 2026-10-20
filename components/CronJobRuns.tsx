"use client";

import { useEffect, useState } from "react";
import type { CronJob, CronJobRun } from "@/lib/cron-types";

type Props = {
  job: CronJob;
  onClose: () => void;
};

const PER = 20;
const STATUS_FILTERS = ["all", "success", "failed", "timeout", "running"] as const;
const TRIGGER_FILTERS = ["all", "scheduled", "test"] as const;

function formatInZone(date: string | null, timezone: string): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString();
  }
}

function prettyBody(body: string | null, contentType: string | null): string {
  if (!body) return "(empty response body)";
  const looksJson = contentType?.includes("json") || /^\s*[[{]/.test(body);
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* fall through */
    }
  }
  return body;
}

export default function CronJobRuns({ job, onClose }: Props) {
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [trigger, setTrigger] = useState<(typeof TRIGGER_FILTERS)[number]>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, CronJobRun>>({});
  const [copied, setCopied] = useState<number | null>(null);

  async function load(p = page, s = status, t = trigger) {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ page: String(p), per: String(PER) });
      if (s !== "all") q.set("status", s);
      if (t !== "all") q.set("trigger", t);
      const res = await fetch(`/api/cron-jobs/${job.id}/runs?${q.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Failed to load runs");
        return;
      }
      setRuns(j.runs ?? []);
      setPage(j.page ?? 1);
      setTotalPages(j.totalPages ?? 1);
      setTotal(j.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(1, status, trigger), 0);
    return () => clearTimeout(t);
  }, [job.id, status, trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggleRun(run: CronJobRun) {
    if (expanded === run.id) {
      setExpanded(null);
      return;
    }
    setExpanded(run.id);
    if (details[run.id] || run.status === "running") return;
    setDetailLoading(run.id);
    try {
      const res = await fetch(`/api/cron-job-runs/${run.id}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.run) setDetails((prev) => ({ ...prev, [run.id]: j.run as CronJobRun }));
      else setError(j.error ?? "Failed to load response");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(null);
    }
  }

  async function copyBody(run: CronJobRun) {
    const detail = details[run.id];
    const text = detail?.response_body ?? run.body_preview ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(run.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const pill = (s: string) =>
    s === "success"
      ? "bg-success/15 text-success"
      : s === "timeout"
        ? "bg-warning/15 text-warning"
        : s === "running"
          ? "bg-primary/15 text-primary-dark"
          : "bg-danger/15 text-danger";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col bg-background shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-text-primary">Run history</h2>
            <p className="truncate text-xs text-text-secondary">
              {job.title} · <span className="font-mono">{job.method} {job.url}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:border-primary hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-5 py-3 text-xs">
          <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-md px-2 py-1 capitalize ${
                  status === s ? "bg-surface font-semibold text-text-primary shadow-sm" : "text-text-secondary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
            {TRIGGER_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrigger(t)}
                className={`rounded-md px-2 py-1 capitalize ${
                  trigger === t ? "bg-surface font-semibold text-text-primary shadow-sm" : "text-text-secondary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="ml-auto text-text-secondary">{total} runs</span>
          <button
            type="button"
            onClick={() => load(page, status, trigger)}
            className="rounded-lg border border-border px-2 py-1 text-text-secondary hover:border-primary hover:text-text-primary"
          >
            Refresh
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {loading && <p className="text-sm text-text-secondary">Loading runs…</p>}
          {!loading && !runs.length && (
            <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
              No runs yet. Use “Test run” to execute this job immediately.
            </p>
          )}

          {runs.map((run) => {
            const detail = details[run.id];
            const isOpen = expanded === run.id;
            return (
              <div key={run.id} className="rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => toggleRun(run)}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left text-sm"
                >
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill(run.status)}`}>
                    {run.status}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                      run.trigger === "test" ? "bg-secondary/15 text-secondary-dark" : "bg-surface-alt text-text-secondary"
                    }`}
                  >
                    {run.trigger}
                  </span>
                  <span className="text-xs text-text-secondary">{formatInZone(run.started_at, job.timezone)}</span>
                  {run.http_status != null && (
                    <span className="font-mono text-[11px] text-text-secondary">HTTP {run.http_status}</span>
                  )}
                  {run.duration_ms != null && (
                    <span className="text-[11px] text-text-secondary">{run.duration_ms}ms</span>
                  )}
                  {run.response_bytes != null && (
                    <span className="text-[11px] text-text-muted">{run.response_bytes} B</span>
                  )}
                  <span className="ml-auto text-[11px] text-text-muted">{isOpen ? "▲" : "▼"}</span>
                </button>

                {run.error && !isOpen && (
                  <p className="truncate border-t border-border px-3 py-1.5 font-mono text-[11px] text-danger">{run.error}</p>
                )}

                {isOpen && (
                  <div className="border-t border-border px-3 py-2.5">
                    {run.error && <p className="mb-2 font-mono text-[11px] text-danger">{run.error}</p>}
                    {run.status === "running" ? (
                      <p className="text-xs text-text-secondary">Still running…</p>
                    ) : detailLoading === run.id ? (
                      <p className="text-xs text-text-secondary">Loading response…</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                          {run.scheduled_for && <span>scheduled {formatInZone(run.scheduled_for, job.timezone)}</span>}
                          {run.response_content_type && (
                            <span className="font-mono text-text-muted">{run.response_content_type}</span>
                          )}
                          {run.response_truncated && <span className="text-warning">response truncated</span>}
                          <span className="ml-auto flex gap-1">
                            <button
                              type="button"
                              onClick={() => copyBody(run)}
                              className="rounded-lg border border-border px-2 py-1 hover:border-primary hover:text-text-primary"
                            >
                              {copied === run.id ? "Copied" : "Copy body"}
                            </button>
                            <a
                              href={`/api/cron-job-runs/${run.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-border px-2 py-1 hover:border-primary hover:text-text-primary"
                            >
                              Open JSON ↗
                            </a>
                          </span>
                        </div>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-alt p-3 font-mono text-[11px] text-text-primary">
                          {prettyBody(detail?.response_body ?? null, run.response_content_type)}
                        </pre>
                        {detail?.response_headers && Object.keys(detail.response_headers).length > 0 && (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-text-secondary">Response headers</summary>
                            <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-surface-alt p-3 font-mono text-[11px] text-text-secondary">
                              {JSON.stringify(detail.response_headers, null, 2)}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2 text-sm">
              <button
                type="button"
                onClick={() => load(page - 1, status, trigger)}
                disabled={page <= 1}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-text-secondary">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => load(page + 1, status, trigger)}
                disabled={page >= totalPages}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-text-primary disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
