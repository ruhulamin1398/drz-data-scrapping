import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/health — liveness + env presence + database reachability (no secrets leaked)
export async function GET() {
  const env = {
    jina: !!process.env.JINA_API_KEY,
    nexRouter: !!process.env.NEX_ROUTER_URL,
    drxBase: !!process.env.DRX_API_BASE,
    drxToken: !!process.env.DRX_ADMIN_TOKEN,
    databaseUrl: !!process.env.DATABASE_URL,
    cronSecret: !!process.env.CRON_SECRET,
  };
  let database: { ok: boolean; latencyMs?: number; error?: string } = { ok: false, error: "DATABASE_URL missing" };
  if (env.databaseUrl) {
    const started = Date.now();
    try {
      await db().query("SELECT 1");
      database = { ok: true, latencyMs: Date.now() - started };
    } catch (e: unknown) {
      database = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }
  const degraded = !database.ok;
  return NextResponse.json(
    { status: degraded ? "degraded" : "ok", time: new Date().toISOString(), env, database },
    { status: degraded ? 503 : 200 }
  );
}
