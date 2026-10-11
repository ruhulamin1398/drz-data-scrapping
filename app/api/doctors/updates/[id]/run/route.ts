import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyPhoto, updatePhoto } from "@/lib/doctor-update/photo";
import { applyExperience, updateExperience } from "@/lib/doctor-update/experience";
import type { PhotoOptions, ExperienceOptions } from "@/lib/doctor-update/types";

// POST /api/doctors/updates/:id/run — immediate single-run execution (browser path,
// same as worker). Marks the row success/failed in place; use retry endpoint for history.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = Number(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const pool = db();
    const cur = await pool.query(`SELECT * FROM doctor_update_runs WHERE id=$1`, [runId]);
    if (!cur.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const q = cur.rows[0] as {
      id: number; doctor_queue_id: number; drx_id: string | null; source_url: string;
      type: string; status: string; options: PhotoOptions | ExperienceOptions; attempts: number;
    };
    if (q.type !== "photo" && q.type !== "experience") return NextResponse.json({ error: `unsupported type: ${q.type}` }, { status: 400 });
    if (!q.drx_id) return NextResponse.json({ error: "drxId required (push first via /doctors)" }, { status: 400 });
    await pool.query(`UPDATE doctor_update_runs SET status='processing', locked_at=NULL, attempts=attempts+1, updated_at=now() WHERE id=$1`, [runId]);
    try {
      if (q.type === "experience") {
        const skipFlag = ((q.options ?? {}) as ExperienceOptions).skipIfExperienceSet !== false;
        const dq = await pool.query(
          `SELECT name, specialty_slug, card_text FROM doctor_queue WHERE id=$1`,
          [q.doctor_queue_id]
        ).catch(() => ({ rows: [] as { name: string | null; specialty_slug: string | null; card_text: string | null }[] }));
        const outcome = await updateExperience(
          {
            doctorQueueId: q.doctor_queue_id, drxId: q.drx_id, sourceUrl: q.source_url,
            doctorName: dq.rows[0]?.name ?? null, speciality: dq.rows[0]?.specialty_slug ?? null,
            cardText: dq.rows[0]?.card_text ?? null,
          },
          { skipIfExperienceSet: skipFlag }
        );
        if (outcome.action === "skipped") {
          const note = `skipped: ${outcome.reason} | prev: ${outcome.prevValue || "none"} | skipIfExists=${skipFlag ? "on" : "off"}`;
          await pool.query(
            `UPDATE doctor_update_runs SET status='skipped', result='skipped', fail_reason=$2, note=$3, finished_at=now(), updated_at=now() WHERE id=$1`,
            [runId, outcome.reason.slice(0, 300), note.slice(0, 1000)]
          );
          return NextResponse.json({ ok: true, result: "skipped", reason: outcome.reason });
        }
        await applyExperience(q.drx_id, outcome.newValue);
        const note = `experience ${outcome.prevValue || "none"} → ${outcome.newValue} years | skipIfExists=${skipFlag ? "on" : "off"}`;
        await pool.query(
          `UPDATE doctor_update_runs SET status='success', result='updated', note=$2, fail_reason=NULL, finished_at=now(), updated_at=now() WHERE id=$1`,
          [runId, note.slice(0, 1000)]
        );
        return NextResponse.json({ ok: true, result: "updated" });
      }
      const skipFlag = ((q.options ?? {}) as PhotoOptions).skipIfPhotoExists !== false;
      const outcome = await updatePhoto(
        { doctorQueueId: q.doctor_queue_id, drxId: q.drx_id, sourceUrl: q.source_url },
        { skipIfPhotoExists: skipFlag }
      );
      if (outcome.action === "skipped") {
        const note = `skipped: ${outcome.reason} | prev: ${outcome.prevPhoto || "none"} | skipIfExists=${skipFlag ? "on" : "off"}`;
        await pool.query(
          `UPDATE doctor_update_runs SET status='skipped', result='skipped', prev_photo=$2, fail_reason=$3, note=$4, finished_at=now(), updated_at=now() WHERE id=$1`,
          [runId, outcome.prevPhoto || null, outcome.reason.slice(0, 300), note.slice(0, 1000)]
        );
        return NextResponse.json({ ok: true, result: "skipped", reason: outcome.reason });
      }
      await applyPhoto(q.drx_id, outcome.newPhoto);
      const note = `photo ${outcome.prevPhoto || "none"} → ${outcome.newPhoto} | skipIfExists=${skipFlag ? "on" : "off"}`;
      await pool.query(
        `UPDATE doctor_update_runs SET status='success', result='updated', prev_photo=$2, new_photo=$3, fail_reason=NULL, note=$4, finished_at=now(), updated_at=now() WHERE id=$1`,
        [runId, outcome.prevPhoto || null, outcome.newPhoto, note.slice(0, 1000)]
      );
      return NextResponse.json({ ok: true, result: "updated" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Transient abort (e.g. search timeout): requeue as pending instead of
      // failing, up to 5 attempts.
      if (/abort/i.test(msg) && (q.attempts ?? 0) < 5) {
        await pool.query(
          `UPDATE doctor_update_runs SET status='pending', locked_at=NULL, fail_reason=$2, finished_at=NULL, updated_at=now() WHERE id=$1`,
          [runId, `retryable: ${msg}`.slice(0, 300)]
        );
        return NextResponse.json({ ok: true, result: "pending", reason: msg.slice(0, 300) });
      }
      await pool.query(
        `UPDATE doctor_update_runs SET status='failed', result='failed', fail_reason=$2, finished_at=now(), updated_at=now() WHERE id=$1`,
        [runId, msg.slice(0, 300)]
      );
      return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
