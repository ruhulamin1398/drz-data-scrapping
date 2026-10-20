export type CronScheduleMode = "preset" | "custom";
export type CronMethod = "GET" | "POST";
export type CronTrigger = "scheduled" | "test";
export type CronRunStatus = "running" | "success" | "failed" | "timeout";
export type CronJobStatus = "success" | "failed" | null;

export type CronJobHeader = {
  key: string;
  value: string;
  enabled: boolean;
};

export type CronJob = {
  id: number;
  title: string;
  url: string;
  comment: string | null;
  schedule_mode: CronScheduleMode;
  schedule_preset: string | null;
  cron_expression: string;
  timezone: string;
  tags: string[];
  method: CronMethod;
  headers: CronJobHeader[];
  body: string | null;
  timeout_ms: number;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: CronJobStatus;
  last_http_status: number | null;
  last_duration_ms: number | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
  next_runs: string[];
};

export type CronJobRun = {
  id: number;
  job_id: number;
  trigger: CronTrigger;
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: CronRunStatus;
  request_url: string;
  request_method: CronMethod;
  http_status: number | null;
  response_content_type: string | null;
  response_headers: Record<string, string> | null;
  response_body?: string | null;
  response_truncated: boolean;
  response_bytes: number | null;
  error: string | null;
  created_at: string;
  body_preview?: string | null;
};

export type CronRunResult = {
  status: Exclude<CronRunStatus, "running">;
  httpStatus: number | null;
  durationMs: number;
  contentType: string | null;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  bytes: number;
  error: string | null;
};

export type CronJobConfig = {
  title: string;
  url: string;
  comment: string | null;
  schedule_mode: CronScheduleMode;
  schedule_preset: string | null;
  cron_expression: string;
  timezone: string;
  tags: string[];
  method: CronMethod;
  headers: CronJobHeader[];
  body: string | null;
  timeout_ms: number;
  enabled: boolean;
};

export type TagSuggestion = {
  name: string;
  count: number;
};

export type CronJobCounts = {
  total: number;
  active: number;
  paused: number;
  failing: number;
};
