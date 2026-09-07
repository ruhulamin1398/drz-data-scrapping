import { NextRequest, NextResponse } from "next/server";
import { locationBlock } from "@/lib/locations";

// POST { trimmed, divisionId } — nex-router settings come from .env.local only
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trimmed: string = body.trimmed ?? "";
    const divisionId = Number(body.divisionId ?? 41);
    const nexUrl = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/v1/chat/completions";
    const model = process.env.NEX_MODEL || "gemini";
    if (!trimmed) return NextResponse.json({ error: "trimmed content required" }, { status: 400 });

    const prompt =
`You extract facility information. Output ONLY the result, no reasoning, no explanation.

Location information:
${locationBlock(divisionId)}

Extract from content below and output EXACTLY these 6 lines, nothing else:
name: <facility name>
fullAddress: <full street address from Address line>
phones: ["...", "..."]
extraInformation: "<1-2 sentence Bengali description from content, not doctor list>"
divisionId: ${divisionId}
districtId: <match district from address using ids above>

Content:
` + trimmed;

    const res = await fetch(nexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.0,
        stream: false,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `extract failed: ${res.status} ${t.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ extracted: data?.choices?.[0]?.message?.content?.trim() ?? "" });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
