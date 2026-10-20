import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildCronJobConfig,
  computeNextRunAt,
  serializeJob,
  type CronJobRow,
} from "@/lib/cron-jobs";
import type { CronJobCounts, TagSuggestion } from "@/lib/cron-types";

export const dynamic = "force-dynamic";

// GET /api/cron-jobs?q=&status=active|paused|failing&tags=a,b&tagMode=any|all&sort=next|title|recent|deleted&deleted=1
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 200);
    const status = sp.get("status") ?? "all";
    const tagMode = sp.get("tagMode") === "all" ? "all" : "any";
    const sort = sp.get("sort") ?? "next";
    const trashed = sp.get("deleted") === "1" || sp.get("deleted") === "true";
    const tags = (sp.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);

    const pool = db();
    const conds: string[] = [trashed ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
    const vals: unknown[] = [];
    if (q) {
      vals.push(`%${q}%`);
      const n = vals.length;
      conds.push(`(title ILIKE $${n} OR url ILIKE $${n} OR COALESCE(comment, '') ILIKE $${n})`);
    }
    if (status === "active") conds.push("enabled = true");
    if (status === "paused") conds.push("enabled = false");
    if (status === "failing") conds.push("last_status = 'failed'");
    if (tags.length) {
      vals.push(tags);
      conds.push(tagMode === "all" ? `tags @> $${vals.length}::text[]` : `tags && $${vals.length}::text[]`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const order =
      sort === "deleted"
        ? "deleted_at DESC NULLS LAST, id DESC"
        : sort === "title"
          ? "lower(title) ASC, id DESC"
          : sort === "recent"
            ? "last_run_at DESC NULLS LAST, id DESC"
            : "next_run_at ASC NULLS LAST, id DESC";

    const rows = await pool.query(
      `SELECT * FROM cron_jobs ${where} ORDER BY ${order} LIMIT 500`,
      vals
    );
    const jobs = (rows.rows as CronJobRow[]).map(serializeJob);

    const countsRes = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
              COUNT(*) FILTER (WHERE deleted_at IS NULL AND enabled)::int AS active,
              COUNT(*) FILTER (WHERE deleted_at IS NULL AND NOT enabled)::int AS paused,
              COUNT(*) FILTER (WHERE deleted_at IS NULL AND last_status = 'failed')::int AS failing,
              COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
       FROM cron_jobs`
    );
    const c = countsRes.rows[0] ?? {};
    const counts: CronJobCounts = {
      total: Number(c.total) || 0,
      active: Number(c.active) || 0,
      paused: Number(c.paused) || 0,
      failing: Number(c.failing) || 0,
      deleted: Number(c.deleted) || 0,
    };

    const tagRes = await pool.query(
      `SELECT tag, COUNT(*)::int AS count
       FROM (SELECT unnest(tags) AS tag FROM cron_jobs WHERE deleted_at IS NULL) t
       GROUP BY tag ORDER BY count DESC, tag ASC`
    );
    const tagList: TagSuggestion[] = tagRes.rows.map((r) => ({
      name: String(r.tag),
      count: Number(r.count) || 0,
    }));

    const heartbeat = await pool
      .query(`SELECT cron_jobs_heartbeat_at FROM settings WHERE id=1`)
      .catch(() => ({ rows: [] as { cron_jobs_heartbeat_at: string | null }[] }));

    return NextResponse.json({
      jobs,
      counts,
      tags: tagList,
      heartbeatAt: heartbeat.rows[0]?.cron_jobs_heartbeat_at ?? null,
      now: new Date().toISOString(),
      resolutionSeconds: 60,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: /relation .*cron_jobs.* does not exist/i.test(msg)
          ? `${msg} — run: node scripts/migrate-cron-jobs.mjs (or POST /api/cron-jobs/migrate with x-cron-secret)`
          : msg,
      },
      { status: 500 }
    );
  }
}

// POST /api/cron-jobs — create a job. next_run_at is stamped immediately when enabled.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON body required" }, { status: 400 });
    }
    const built = buildCronJobConfig(body);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    const cfg = built.value;
    const next = cfg.enabled ? computeNextRunAt(cfg.cron_expression, cfg.timezone) : null;
    const r = await db().query(
      `INSERT INTO cron_jobs
        (title, url, comment, schedule_mode, schedule_preset, cron_expression, timezone, tags,
         method, headers, body, timeout_ms, enabled, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        cfg.title,
        cfg.url,
        cfg.comment,
        cfg.schedule_mode,
        cfg.schedule_preset,
        cfg.cron_expression,
        cfg.timezone,
        cfg.tags,
        cfg.method,
        JSON.stringify(cfg.headers),
        cfg.body,
        cfg.timeout_ms,
        cfg.enabled,
        next,
      ]
    );
    return NextResponse.json({ job: serializeJob(r.rows[0] as CronJobRow) }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
