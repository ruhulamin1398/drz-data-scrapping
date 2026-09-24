import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadSitemapUrls, upsertPrewarmUrls } from "@/lib/prewarm";

// POST /api/prewarm/load { sitemapUrl } — parse sitemap (follows nested
// sitemapindex), upsert all page URLs as pending. Existing rows keep status.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.sitemapUrl || !/^https?:\/\//i.test(b.sitemapUrl)) {
      return NextResponse.json({ error: "sitemapUrl (http(s)) required" }, { status: 400 });
    }
    const urls = await loadSitemapUrls(b.sitemapUrl);
    const { discovered, inserted } = await upsertPrewarmUrls(db(), urls);
    const counts = await db().query(`SELECT status, COUNT(*) c FROM prewarm_queue GROUP BY status`);
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ discovered, inserted, counts: byStatus });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
