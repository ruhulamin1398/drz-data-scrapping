// Central env access. Values must come from .env / the hosting environment —
// no hardcoded fallbacks. Missing required vars throw a clear error at use
// time and are reported by GET /api/health.

export function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} missing in .env`);
  return v;
}

// Vars the app cannot work without; /api/health lists the missing ones.
export const REQUIRED_ENV = [
  "DATABASE_URL",
  "CRON_SECRET",
  "JINA_API_KEY",
  "DRX_API_BASE",
  "DRX_ADMIN_TOKEN",
  "NEX_ROUTER_URL",
  "NEX_SEARCH_URL",
  "NEX_MODEL",
  "PAGESPEED_API_URL",
  "REVALIDATE_SECRET",
] as const;

// Optional vars: features degrade gracefully when absent.
export const OPTIONAL_ENV = ["PAGESPEED_API_KEY"] as const;

export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
}
