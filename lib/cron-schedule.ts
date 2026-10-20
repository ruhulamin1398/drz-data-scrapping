import { Cron } from "croner";

// Shared cron schedule helpers — safe to import from client components.
export const DEFAULT_TIMEZONE = "Asia/Dhaka";

export type CronPreset = {
  id: string;
  label: string;
  expression: string;
};

export const CRON_PRESETS: CronPreset[] = [
  { id: "1m", label: "Every 1 minute", expression: "* * * * *" },
  { id: "2m", label: "Every 2 minutes", expression: "*/2 * * * *" },
  { id: "3m", label: "Every 3 minutes", expression: "*/3 * * * *" },
  { id: "5m", label: "Every 5 minutes", expression: "*/5 * * * *" },
  { id: "10m", label: "Every 10 minutes", expression: "*/10 * * * *" },
  { id: "15m", label: "Every 15 minutes", expression: "*/15 * * * *" },
  { id: "30m", label: "Every 30 minutes", expression: "*/30 * * * *" },
  { id: "1h", label: "Every 1 hour", expression: "0 * * * *" },
  { id: "2h", label: "Every 2 hours", expression: "0 */2 * * *" },
  { id: "4h", label: "Every 4 hours", expression: "0 */4 * * *" },
  { id: "6h", label: "Every 6 hours", expression: "0 */6 * * *" },
  { id: "8h", label: "Every 8 hours", expression: "0 */8 * * *" },
  { id: "12h", label: "Every 12 hours", expression: "0 */12 * * *" },
  { id: "24h", label: "Every 24 hours", expression: "0 0 * * *" },
];

export const COMMON_TIMEZONES = [
  "Asia/Dhaka",
  "UTC",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const NICKNAMES: Record<string, string> = {
  "@yearly": "Once a year",
  "@annually": "Once a year",
  "@monthly": "Once a month",
  "@weekly": "Once a week",
  "@daily": "Once a day",
  "@midnight": "Once a day",
  "@hourly": "Every hour",
};

export function findPreset(id: string | null | undefined): CronPreset | null {
  return CRON_PRESETS.find((p) => p.id === id) ?? null;
}

export function resolveExpression(mode: "preset" | "custom", presetId: string | null, custom: string): string {
  if (mode === "preset") return findPreset(presetId)?.expression ?? "";
  return custom.trim();
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

// Croner supports 5/6/7-field expressions. The external trigger fires once a
// minute, so we keep jobs on standard 5-field syntax (or @nicknames) to avoid
// promising second-level precision we cannot deliver.
export function validateSchedule(expression: string, timezone = DEFAULT_TIMEZONE): string | null {
  const expr = expression.trim();
  if (!expr) return "Cron expression is required";
  if (!isValidTimezone(timezone)) return `Unknown timezone: ${timezone}`;
  const isNickname = expr.startsWith("@");
  if (!isNickname && expr.split(/\s+/).length !== 5) {
    return "Use a 5-field cron expression (minute hour day month weekday). The external trigger runs every minute.";
  }
  let cron: Cron | null = null;
  try {
    cron = new Cron(expr, { timezone, paused: true });
    const next = cron.nextRuns(1);
    if (!next.length) return "This expression never fires";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid cron expression";
  } finally {
    try {
      cron?.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function upcomingRuns(
  expression: string,
  timezone = DEFAULT_TIMEZONE,
  count = 3,
  from: Date = new Date()
): Date[] {
  let cron: Cron | null = null;
  try {
    cron = new Cron(expression, { timezone, paused: true });
    return cron.nextRuns(Math.max(1, count), from);
  } finally {
    try {
      cron?.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function describeSchedule(mode: "preset" | "custom", presetId: string | null, expression: string): string {
  if (mode === "preset") return findPreset(presetId)?.label ?? "Preset schedule";
  const expr = expression.trim();
  if (NICKNAMES[expr.toLowerCase()]) return NICKNAMES[expr.toLowerCase()];
  return `Custom · ${expr || "no expression"}`;
}
