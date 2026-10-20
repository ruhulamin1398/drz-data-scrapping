"use client";

import { useEffect, useMemo, useState } from "react";
import TagInput from "./TagInput";
import {
  COMMON_TIMEZONES,
  CRON_PRESETS,
  DEFAULT_TIMEZONE,
  describeSchedule,
  findPreset,
  upcomingRuns,
  validateSchedule,
} from "@/lib/cron-schedule";
import { MAX_TAGS } from "@/lib/tags";
import type {
  CronJob,
  CronJobHeader,
  CronMethod,
  CronRunResult,
  CronScheduleMode,
  TagSuggestion,
} from "@/lib/cron-types";

type Props = {
  job: CronJob | null;
  tagSuggestions: TagSuggestion[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

const fieldCls =
  "w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:border-primary";
const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-text-secondary";
const sectionCls = "rounded-2xl border border-border bg-surface p-4 shadow-sm";

function formatInZone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
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

export default function CronJobEditor({ job, tagSuggestions, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(job?.title ?? "");
  const [url, setUrl] = useState(job?.url ?? "");
  const [comment, setComment] = useState(job?.comment ?? "");
  const [scheduleMode, setScheduleMode] = useState<CronScheduleMode>(job?.schedule_mode ?? "preset");
  const [presetId, setPresetId] = useState(
    job?.schedule_preset && findPreset(job.schedule_preset) ? job.schedule_preset : "5m"
  );
  const [customExpression, setCustomExpression] = useState(
    job?.schedule_mode === "custom" ? job.cron_expression : "*/5 * * * *"
  );
  const [timezone, setTimezone] = useState(job?.timezone ?? DEFAULT_TIMEZONE);
  const [tags, setTags] = useState<string[]>(job?.tags ?? []);
  const [method, setMethod] = useState<CronMethod>(job?.method ?? "GET");
  const [headers, setHeaders] = useState<CronJobHeader[]>(job?.headers ?? []);
  const [body, setBody] = useState(job?.body ?? "");
  const [timeoutMs, setTimeoutMs] = useState(job?.timeout_ms ?? 10_000);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<CronRunResult | null>(null);
  const [testRunId, setTestRunId] = useState<number | null>(null);

  const expression =
    scheduleMode === "preset" ? findPreset(presetId)?.expression ?? "" : customExpression.trim();
  const scheduleError = useMemo(() => validateSchedule(expression, timezone), [expression, timezone]);
  const previewRuns = useMemo(() => {
    if (scheduleError) return [];
    try {
      return upcomingRuns(expression, timezone, 3);
    } catch {
      return [];
    }
  }, [expression, timezone, scheduleError]);

  const timezoneOptions = useMemo(() => {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone") ?? [];
    const common = [...new Set(COMMON_TIMEZONES)];
    const commonSet = new Set(common);
    const rest = supported.filter((z) => !commonSet.has(z)).sort();
    return { common, rest };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function chooseMode(mode: CronScheduleMode) {
    if (mode === scheduleMode) return;
    if (mode === "custom") setCustomExpression(expression || "*/5 * * * *");
    setScheduleMode(mode);
  }

  function updateHeader(index: number, patch: Partial<CronJobHeader>) {
    setHeaders((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  function addHeader(key = "", value = "") {
    setHeaders((prev) => [...prev, { key, value, enabled: true }]);
  }

  const payload = useMemo(
    () => ({
      title,
      url,
      comment,
      schedule_mode: scheduleMode,
      schedule_preset: scheduleMode === "preset" ? presetId : null,
      cron_expression: expression,
      timezone,
      tags,
      method,
      headers,
      body: method === "POST" ? body : null,
      timeout_ms: timeoutMs,
      enabled,
    }),
    [title, url, comment, scheduleMode, presetId, expression, timezone, tags, method, headers, body, timeoutMs, enabled]
  );

  async function save() {
    setError("");
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(job ? `/api/cron-jobs/${job.id}` : "/api/cron-jobs", {
        method: job ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Save failed");
        return;
      }
      onSaved(job ? "Job updated" : "Job created");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setError("");
    setTestResult(null);
    setTestRunId(null);
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/cron-jobs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job?.id ?? null,
          config: { ...payload, title: title.trim() || "Test run" },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Test run failed");
        return;
      }
      setTestResult(j.result as CronRunResult);
      setTestRunId(j.runId ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-text-primary">
              {job ? "Edit cron job" : "New cron job"}
            </h2>
            <p className="text-xs text-text-secondary">{describeSchedule(scheduleMode, presetId, expression)}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-success" : "bg-border"}`}
            title={enabled ? "Enabled" : "Disabled"}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`}
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:border-primary hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
          )}

          <section className={sectionCls}>
            <h3 className="text-sm font-semibold text-text-primary">Basics</h3>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className={labelCls}>Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Warm sitemap cache"
                  className={`mt-1 ${fieldCls}`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/api/endpoint"
                  className={`mt-1 font-mono text-xs ${fieldCls}`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Comment</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="Why this job exists / what it touches"
                  className={`mt-1 ${fieldCls}`}
                />
              </label>
            </div>
          </section>

          <section className={sectionCls}>
            <h3 className="text-sm font-semibold text-text-primary">Schedule</h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              The external trigger checks once a minute, so one minute is the fastest resolution.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["preset", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => chooseMode(mode)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    scheduleMode === mode
                      ? "border-primary bg-primary/10 font-semibold text-primary-dark"
                      : "border-border bg-surface-alt text-text-secondary hover:border-primary/50"
                  }`}
                >
                  <span className="block">{mode === "preset" ? "Preset" : "Cron expression"}</span>
                  <span className="block text-[11px] font-normal text-text-muted">
                    {mode === "preset" ? "Dropdown of common intervals" : "Write a 5-field expression"}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
              <label className="block">
                <span className={labelCls}>{scheduleMode === "preset" ? "Interval" : "Cron expression"}</span>
                {scheduleMode === "preset" ? (
                  <select
                    value={presetId}
                    onChange={(e) => setPresetId(e.target.value)}
                    className={`mt-1 ${fieldCls}`}
                  >
                    {CRON_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} — {p.expression}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={customExpression}
                    onChange={(e) => setCustomExpression(e.target.value)}
                    placeholder="*/5 * * * *"
                    className={`mt-1 font-mono text-xs ${fieldCls}`}
                  />
                )}
              </label>
              <label className="block">
                <span className={labelCls}>Timezone</span>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className={`mt-1 ${fieldCls}`}
                >
                  <optgroup label="Common">
                    {timezoneOptions.common.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="All timezones">
                    {timezoneOptions.rest.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-surface-alt px-2 py-1 font-mono text-text-secondary">{expression || "—"}</span>
              <span className="text-text-muted">minute hour day month weekday</span>
            </div>

            <div className="mt-3 rounded-xl border border-border bg-surface-alt px-3 py-2.5">
              <p className={labelCls}>Next 3 scheduled runs · {timezone}</p>
              {scheduleError ? (
                <p className="mt-1 text-xs text-danger">{scheduleError}</p>
              ) : (
                <ol className="mt-1 space-y-1">
                  {previewRuns.map((d, i) => (
                    <li key={d.toISOString()} className="flex items-center gap-2 text-xs text-text-secondary">
                      <span className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                        {i + 1}
                      </span>
                      <span className="font-medium text-text-primary">{formatInZone(d, timezone)}</span>
                      <span className="text-text-muted">{timezone}</span>
                    </li>
                  ))}
                  {!previewRuns.length && <li className="text-xs text-danger">No upcoming runs</li>}
                </ol>
              )}
            </div>
          </section>

          <section className={sectionCls}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Tags</h3>
              <span className="text-[11px] text-text-muted">
                {tags.length}/{MAX_TAGS}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">Used by the filter bar. Type and press Enter to create.</p>
            <div className="mt-2">
              <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="Add tags…" />
            </div>
          </section>

          <section className={sectionCls}>
            <h3 className="text-sm font-semibold text-text-primary">Request</h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr_110px]">
              <label className="block">
                <span className={labelCls}>Method</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value === "POST" ? "POST" : "GET")}
                  className={`mt-1 ${fieldCls}`}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <div>
                <span className={labelCls}>Headers</span>
                <div className="mt-1 space-y-2">
                  {headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={h.enabled}
                        onChange={(e) => updateHeader(i, { enabled: e.target.checked })}
                        title="Send this header"
                        className="h-4 w-4 shrink-0"
                      />
                      <input
                        value={h.key}
                        onChange={(e) => updateHeader(i, { key: e.target.value })}
                        placeholder="Header"
                        list="cron-header-names"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-surface-alt px-2 py-1.5 font-mono text-[11px] text-text-primary outline-none focus:border-primary"
                      />
                      <input
                        value={h.value}
                        onChange={(e) => updateHeader(i, { value: e.target.value })}
                        placeholder="Value"
                        type={/authorization|secret|token|key/i.test(h.key) ? "password" : "text"}
                        className="min-w-0 flex-[2] rounded-lg border border-border bg-surface-alt px-2 py-1.5 font-mono text-[11px] text-text-primary outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setHeaders((prev) => prev.filter((_, x) => x !== i))}
                        className="rounded-lg border border-border px-1.5 py-1 text-xs text-text-secondary hover:border-danger hover:text-danger"
                        title="Remove header"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <datalist id="cron-header-names">
                    <option value="Content-Type" />
                    <option value="Authorization" />
                    <option value="Accept" />
                    <option value="x-cron-secret" />
                    <option value="User-Agent" />
                  </datalist>
                  <button
                    type="button"
                    onClick={() => addHeader()}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-text-secondary hover:border-primary hover:text-text-primary"
                  >
                    + Add header
                  </button>
                </div>
              </div>
              <label className="block">
                <span className={labelCls}>Timeout (ms)</span>
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={1000}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Math.min(30000, Math.max(1000, Number(e.target.value) || 1000)))}
                  className={`mt-1 ${fieldCls}`}
                />
              </label>
            </div>

            {method === "POST" && (
              <label className="mt-3 block">
                <span className={labelCls}>Body</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder='{"key":"value"}'
                  className={`mt-1 font-mono text-xs ${fieldCls}`}
                />
                <span className="mt-1 block text-[11px] text-text-muted">
                  If no Content-Type header is set, JSON-looking bodies are sent as application/json.
                </span>
              </label>
            )}
          </section>

          {testResult && (
            <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Test run result</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    testResult.status === "success"
                      ? "bg-success/15 text-success"
                      : testResult.status === "timeout"
                        ? "bg-warning/15 text-warning"
                        : "bg-danger/15 text-danger"
                  }`}
                >
                  {testResult.status}
                </span>
                {testResult.httpStatus != null && (
                  <span className="rounded-md bg-surface-alt px-2 py-0.5 font-mono text-[11px] text-text-secondary">
                    HTTP {testResult.httpStatus}
                  </span>
                )}
                <span className="text-[11px] text-text-secondary">{testResult.durationMs}ms</span>
                <span className="text-[11px] text-text-secondary">{testResult.bytes} B</span>
                {testResult.truncated && <span className="text-[11px] text-warning">truncated</span>}
                {testRunId !== null && <span className="text-[11px] text-text-muted">saved as run #{testRunId}</span>}
              </div>
              {testResult.error && <p className="mt-2 font-mono text-[11px] text-danger">{testResult.error}</p>}
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface-alt p-3 font-mono text-[11px] text-text-primary">
                {prettyBody(testResult.body, testResult.contentType)}
              </pre>
              {Object.keys(testResult.headers).length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-text-secondary">Response headers</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-surface-alt p-3 font-mono text-[11px] text-text-secondary">
                    {JSON.stringify(testResult.headers, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-text-secondary hover:border-primary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={test}
            disabled={testing || saving}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-primary hover:border-primary disabled:opacity-40"
          >
            {testing ? "Testing…" : "Test run"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || testing}
            className="ml-auto rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : job ? "Save changes" : "Create job"}
          </button>
        </div>
      </div>
    </div>
  );
}
