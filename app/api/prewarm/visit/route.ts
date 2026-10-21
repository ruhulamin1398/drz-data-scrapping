import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { revalidateUrl } from "@/lib/prewarm";

// Allow the manual/retry path to wait for a slow cold render (REVALIDATE_TIMEOUT_MS).
export const maxDuration = 300;

// POST /api/prewarm/visit { url } — single ISR revalidate call (5 min timeout).
// The frontend admin endpoint marks the page stale, cold-renders it and stamps
// the sitemap store; the caller marks the queue row. warmed=true (<400) = ok.
// Base URL comes from settings.revalidate_base_url (editable on /prewarm).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const r = await db().query("SELECT revalidate_base_url FROM settings WHERE id=1");
    const base = String(r.rows[0]?.revalidate_base_url ?? "").trim();
    if (!base) {
      return NextResponse.json({ error: "revalidate base URL not configured — set it on /prewarm" }, { status: 400 });
    }
    const v = await revalidateUrl(b.url, base);
    return NextResponse.json(v);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
