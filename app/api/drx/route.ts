import { NextRequest, NextResponse } from "next/server";
import { pushDrx } from "@/lib/scrape";

// POST { name, divisionId, districtId, typeId, fullAddress, phones[], extraInformation, drxId? }
// Without drxId: creates on drx-backend. With drxId: PATCHes in place (no duplicates).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const r = await pushDrx({
      name: b.name, divisionId: b.divisionId, districtId: b.districtId, typeId: b.typeId,
      fullAddress: b.fullAddress || "", phones: b.phones || [],
      extraInformation: b.extraInformation || "", drxId: b.drxId,
    });
    return NextResponse.json(r.updated ? { drxId: r.drxId, updated: true } : { drxId: r.drxId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("missing") || msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
