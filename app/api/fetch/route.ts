import { NextRequest, NextResponse } from "next/server";

const TRIM_LINES = 30;

// POST { url } — jina key comes from .env.local only
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = body.url;
    const jinaKey = process.env.JINA_API_KEY || "";
    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
    if (!jinaKey) return NextResponse.json({ error: "JINA_API_KEY missing in .env.local" }, { status: 400 });

    const target = url.startsWith("https://r.jina.ai/") ? url : `https://r.jina.ai/${url}`;
    const res = await fetch(target, { headers: { Authorization: `Bearer ${jinaKey}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `fetch failed: ${res.status} ${t.slice(0, 200)}` }, { status: 502 });
    }
    const raw = await res.text();
    const lines = raw.split("\n");
    return NextResponse.json({ totalLines: lines.length, trimmed: lines.slice(0, TRIM_LINES).join("\n") });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
