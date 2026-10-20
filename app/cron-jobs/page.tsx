"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CronJobEditor from "@/components/CronJobEditor";
import CronJobRuns from "@/components/CronJobRuns";
import TagInput from "@/components/TagInput";
import { describeSchedule } from "@/lib/cron-schedule";
import type {
  CronJob,
  CronJobCounts,
  CronRunResult,
  TagSuggestion,
} from "@/lib/cron-types";

type StatusFilter = "all" | "active" | "paused" | "failing";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "failing", label: "Failing" },
];

function formatInZone(date: string | null, timezone: string): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString();
  }
}

function relativeTime(date: string | null, now: number): string {
  if (!date) return "never";
  const diff = Math.round((new Date(date).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const future = diff >= 0;
  const value =
    abs < 60
      ? `${abs}s`
      : abs < 3600
        ? `${Math.round(abs / 60)}m`
        : abs < 86_400
          ? `${Math.round(abs / 3600)}h`
          : `${Math.round(abs / 86_400)}d`;
  return future ? `in ${value}` : `${value} ago`;
}

function prettyBody(body: string, contentType: string | null): string {
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

export default function CronJobsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [counts, setCounts] = useState<CronJobCounts>({ total: 0, active: 0, paused: 0, failing: 0 });
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [heartbeatAt, setHeartbeatAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"any" | "all">("any");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [runsJob, setRunsJob] = useState<CronJob | null>(null);

  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<
    Record<number, { result: CronRunResult; runId: number | null }>
  >({});
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const [clock, setClock] = useState(0);
  const mounted = clock > 0;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "all") params.set("status", status);
      if (selectedTags.length) {
        params.set("tags", selectedTags.join(","));
        params.set("tagMode", tagMode);
      }
      const res = await fetch(`/api/cron-jobs?${params.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "Failed to load cron jobs");
        return;
      }
      setJobs(j.jobs ?? []);
      setCounts(j.counts ?? { total: 0, active: 0, paused: 0, failing: 0 });
      setTagSuggestions(j.tags ?? []);
      setHeartbeatAt(j.heartbeatAt ?? null);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [q, status, selectedTags, tagMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(() => load(), 15_000);
    return () => clearInterval(t);
  }, [q, status, selectedTags, tagMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const heartbeatAge = useMemo(() => {
    if (!heartbeatAt) return null;
    return Math.max(0, Math.round((clock - new Date(heartbeatAt).getTime()) / 1000));
  }, [heartbeatAt, clock]);
  const schedulerLive = heartbeatAge != null && heartbeatAge < 180;

  async function toggleJob(job: CronJob) {
    setBusy(job.id);
    setMsg("");
    try {
      const res = await fetch(`/api/cron-jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? `${job.title}: ${!job.enabled ? "enabled" : "paused"}` : j.error ?? "Toggle failed");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function duplicateJob(job: CronJob) {
    setBusy(job.id);
    setMsg("");
    try {
      const res = await fetch("/api/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${job.title} (copy)`,
          url: job.url,
          comment: job.comment,
          schedule_mode: job.schedule_mode,
          schedule_preset: job.schedule_preset,
          cron_expression: job.cron_expression,
          timezone: job.timezone,
          tags: job.tags,
          method: job.method,
          headers: job.headers,
          body: job.body,
          timeout_ms: job.timeout_ms,
          enabled: false,
        }),
      });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Duplicated “${job.title}” (paused)` : j.error ?? "Duplicate failed");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function deleteJob(job: CronJob) {
    if (!confirm(`Delete “${job.title}”? Its run history will be removed too.`)) return;
    setBusy(job.id);
    setMsg("");
    try {
      const res = await fetch(`/api/cron-jobs/${job.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Deleted “${job.title}”` : j.error ?? "Delete failed");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function testJob(job: CronJob) {
    setTesting(job.id);
    setExpandedTest(job.id);
    setMsg("");
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[job.id];
      return next;
    });
    try {
      const res = await fetch("/api/cron-jobs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "Test run failed");
        return;
      }
      setTestResults((prev) => ({
        ...prev,
        [job.id]: { result: j.result as CronRunResult, runId: j.runId ?? null },
      }));
      await load();
    } finally {
      setTesting(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-text-primary">Cron jobs</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Schedule HTTP requests. The external 1-minute trigger runs due jobs in the background, alongside the
            processor tick.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingJob(null);
            setEditorOpen(true);
          }}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          + New job
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {(
          [
            ["Total", counts.total, "text-text-primary"],
            ["Active", counts.active, "text-success"],
            ["Paused", counts.paused, "text-text-secondary"],
            ["Failing", counts.failing, "text-danger"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-xs shadow-sm">
        <span className="flex items-center gap-2 font-medium text-text-primary">
          <span
            className={`h-2 w-2 rounded-full ${
              !mounted ? "bg-border" : schedulerLive ? "bg-success" : heartbeatAt ? "bg-warning" : "bg-border"
            }`}
          />
          {!mounted
            ? "Scheduler status"
            : schedulerLive
              ? "Scheduler live"
              : heartbeatAt
                ? "Scheduler stale"
                : "Waiting for first tick"}
        </span>
        <span className="text-text-secondary">
          {mounted && heartbeatAge != null ? `Last check ${heartbeatAge}s ago` : "No check recorded yet"}
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-secondary">resolution 1 min</span>
        <Link href="/history" className="ml-auto text-text-secondary hover:text-primary-dark">
          Processor history →
        </Link>
      </div>

      <div className="mt-4 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, URL or comment…"
            className="min-w-56 flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          />
          <div className="flex gap-1 rounded-xl bg-surface-alt p-1 text-sm">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatus(tab.id)}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  status === tab.id
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-xl border border-border px-3 py-2 text-sm text-text-secondary hover:border-primary hover:text-text-primary"
          >
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-56 flex-[2]">
            <TagInput
              value={selectedTags}
              onChange={setSelectedTags}
              suggestions={tagSuggestions}
              placeholder="Filter by tag…"
            />
          </div>
          {selectedTags.length > 1 && (
            <div className="flex gap-1 rounded-xl bg-surface-alt p-1 text-xs">
              <button
                type="button"
                onClick={() => setTagMode("any")}
                className={`rounded-lg px-2.5 py-1.5 font-medium ${
                  tagMode === "any" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary"
                }`}
              >
                Any tag
              </button>
              <button
                type="button"
                onClick={() => setTagMode("all")}
                className={`rounded-lg px-2.5 py-1.5 font-medium ${
                  tagMode === "all" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary"
                }`}
              >
                All tags
              </button>
            </div>
          )}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="rounded-xl border border-border px-2.5 py-2 text-xs text-text-secondary hover:border-danger hover:text-danger"
            >
              Clear tags
            </button>
          )}
          {loading && <span className="text-xs text-text-muted">Loading…</span>}
        </div>
      </div>

      {msg && (
        <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text-secondary">
          {msg}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {!loading && jobs.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-text-primary">No cron jobs yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Create one to call an endpoint on a schedule — GET or POST, with headers and saved responses.
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingJob(null);
                setEditorOpen(true);
              }}
              className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              + New job
            </button>
          </div>
        )}

        {jobs.map((job) => {
          const test = testResults[job.id];
          const running = testing === job.id;
          return (
            <div key={job.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={job.enabled}
                  onClick={() => toggleJob(job)}
                  disabled={busy === job.id}
                  title={job.enabled ? "Disable job" : "Enable job"}
                  className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition ${
                    job.enabled ? "bg-success" : "bg-border"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      job.enabled ? "left-5" : "left-1"
                    }`}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-bold text-text-primary">{job.title}</h2>
                    <span className="rounded-md bg-surface-alt px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
                      {job.method}
                    </span>
                    {!job.enabled && (
                      <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        paused
                      </span>
                    )}
                    {job.last_status === "failed" && (
                      <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-semibold text-danger">
                        failing · {job.consecutive_failures}
                      </span>
                    )}
                    {job.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary-dark"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block truncate font-mono text-[11px] text-text-secondary hover:text-primary-dark hover:underline"
                    title={job.url}
                  >
                    {job.url} ↗
                  </a>
                  {job.comment && <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{job.comment}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => testJob(job)}
                    disabled={running || busy === job.id}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-primary hover:border-primary disabled:opacity-40"
                  >
                    {running ? "Testing…" : "▶ Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingJob(job);
                      setEditorOpen(true);
                    }}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-primary hover:text-text-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunsJob(job)}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-primary hover:text-text-primary"
                  >
                    Runs
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateJob(job)}
                    disabled={busy === job.id}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-primary hover:text-text-primary disabled:opacity-40"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteJob(job)}
                    disabled={busy === job.id}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-danger hover:border-danger disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    {describeSchedule(job.schedule_mode, job.schedule_preset, job.cron_expression)} · {job.timezone}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-muted">{job.cron_expression}</p>
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      Next 3 {job.enabled ? "" : "(paused)"}
                    </p>
                    {job.next_runs.length ? (
                      job.next_runs.map((next, i) => (
                        <div key={`${next}-${i}`} className="flex items-center gap-2 text-[11px]">
                          <span className="w-3 font-mono text-text-muted">{i + 1}.</span>
                          <span className="text-text-primary">{formatInZone(next, job.timezone)}</span>
                          {mounted && <span className="text-text-muted">· {relativeTime(next, clock)}</span>}
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-danger">No upcoming runs — check the expression</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Last run</p>
                  {job.last_run_at ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          job.last_status === "success"
                            ? "bg-success/15 text-success"
                            : job.last_status === "failed"
                              ? "bg-danger/15 text-danger"
                              : "bg-surface-alt text-text-secondary"
                        }`}
                      >
                        {job.last_status ?? "unknown"}
                      </span>
                      {job.last_http_status != null && (
                        <span className="font-mono text-text-secondary">HTTP {job.last_http_status}</span>
                      )}
                      {job.last_duration_ms != null && (
                        <span className="text-text-secondary">{job.last_duration_ms}ms</span>
                      )}
                      <span className="text-text-secondary">{formatInZone(job.last_run_at, job.timezone)}</span>
                      {mounted && <span className="text-text-muted">· {relativeTime(job.last_run_at, clock)}</span>}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-text-secondary">
                      No runs yet — use Test run for an immediate check.
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setRunsJob(job)}
                      className="rounded-lg border border-border px-2 py-1 text-text-secondary hover:border-primary hover:text-text-primary"
                    >
                      View run history
                    </button>
                    {job.enabled && job.next_run_at && mounted && (
                      <span className="rounded-lg bg-surface-alt px-2 py-1 text-text-muted">
                        next {relativeTime(job.next_run_at, clock)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {test && (
                <div className="mt-3 rounded-xl bg-surface-alt px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        test.result.status === "success"
                          ? "bg-success/15 text-success"
                          : test.result.status === "timeout"
                            ? "bg-warning/15 text-warning"
                            : "bg-danger/15 text-danger"
                      }`}
                    >
                      test {test.result.status}
                    </span>
                    {test.result.httpStatus != null && (
                      <span className="font-mono text-text-secondary">HTTP {test.result.httpStatus}</span>
                    )}
                    <span className="text-text-secondary">{test.result.durationMs}ms</span>
                    <span className="text-text-secondary">{test.result.bytes} B</span>
                    {test.runId !== null && <span className="text-text-muted">run #{test.runId}</span>}
                    <button
                      type="button"
                      onClick={() => setExpandedTest(expandedTest === job.id ? null : job.id)}
                      className="ml-auto rounded-lg border border-border px-2 py-0.5 text-text-secondary hover:border-primary hover:text-text-primary"
                    >
                      {expandedTest === job.id ? "Hide" : "Show"}
                    </button>
                  </div>
                  {expandedTest === job.id && (
                    <>
                      {test.result.error && (
                        <p className="mt-1 font-mono text-[11px] text-danger">{test.result.error}</p>
                      )}
                      <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-text-primary">
                        {prettyBody(test.result.body, test.result.contentType)}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editorOpen && (
        <CronJobEditor
          key={editingJob?.id ?? "new"}
          job={editingJob}
          tagSuggestions={tagSuggestions}
          onClose={() => setEditorOpen(false)}
          onSaved={(message) => {
            setEditorOpen(false);
            setMsg(message);
            load();
          }}
        />
      )}

      {runsJob && <CronJobRuns job={runsJob} onClose={() => setRunsJob(null)} />}
    </main>
  );
}
