import { NextRequest, NextResponse } from "next/server";
import { fetchSource } from "@/lib/scrape";

// POST { url, full? } — jina key comes from env only.
// full=true returns the entire response (used on retry); default trims to first 30 lines.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json(await fetchSource(body.url, body.full === true));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("missing") || msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
