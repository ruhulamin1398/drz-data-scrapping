import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { REQUIRED_ENV, OPTIONAL_ENV, missingEnv } from "@/lib/env";

// GET /api/health — liveness + env presence + database reachability (no secrets leaked).
// `env` maps every known variable to present/absent; `missing` lists the required
// vars that are not set, so a missing .env entry is visible here.
export async function GET() {
  const envPresence: Record<string, boolean> = {};
  for (const k of [...REQUIRED_ENV, ...OPTIONAL_ENV]) envPresence[k] = !!process.env[k]?.trim();
  const missing = missingEnv();
  const databaseUrlPresent = !!process.env.DATABASE_URL?.trim();
  let database: { ok: boolean; latencyMs?: number; error?: string } = { ok: false, error: "DATABASE_URL missing" };
  if (databaseUrlPresent) {
    const started = Date.now();
    try {
      await db().query("SELECT 1");
      database = { ok: true, latencyMs: Date.now() - started };
    } catch (e: unknown) {
      database = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }
  const degraded = missing.length > 0 || !database.ok;
  return NextResponse.json(
    {
      status: degraded ? "degraded" : "ok",
      time: new Date().toISOString(),
      env: envPresence,
      missing,
      database,
    },
    { status: degraded ? 503 : 200 }
  );
}
