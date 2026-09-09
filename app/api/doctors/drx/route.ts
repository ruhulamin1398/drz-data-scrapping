import { NextRequest, NextResponse } from "next/server";
import { pushDoctor } from "@/lib/doctor";

// POST { doctor, departmentIds, sourceUrl, drxId? } — creates the DRX doctor,
// posts each degree with doctorId, chambers go into extraInformation as text.
// With drxId: PATCHes in place (no duplicates).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.doctor || !b.departmentIds?.length || !b.sourceUrl) {
      return NextResponse.json({ error: "doctor + departmentIds + sourceUrl required" }, { status: 400 });
    }
    const r = await pushDoctor({ ...b.doctor, departmentIds: b.departmentIds, sourceUrl: b.sourceUrl, drxId: b.drxId });
    return NextResponse.json(r.updated ? { drxId: r.drxId, updated: true, degrees: r.degrees } : { drxId: r.drxId, degrees: r.degrees });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("missing") || msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
