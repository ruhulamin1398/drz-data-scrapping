import { NextRequest, NextResponse } from "next/server";

// POST { name, divisionId, districtId, typeId, fullAddress, phones[], extraInformation, drxId? }
// Without drxId: creates the facility on drx-backend. With drxId: updates it in place
// (used when retrying an already-pushed row, so no duplicate is created).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const base = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
    const token = process.env.DRX_ADMIN_TOKEN || "";
    if (!token) return NextResponse.json({ error: "DRX_ADMIN_TOKEN missing in .env.local" }, { status: 400 });
    if (!b.name || !b.divisionId || !b.districtId || !b.typeId) {
      return NextResponse.json({ error: "name, divisionId, districtId, typeId required" }, { status: 400 });
    }
    const payload = {
      name: b.name, divisionId: b.divisionId, districtId: b.districtId, typeId: b.typeId,
      fullAddress: b.fullAddress || "", phones: b.phones || [],
      extraInformation: b.extraInformation || "",
    };
    if (b.drxId) {
      const res = await fetch(`${base}/api/v1/facilities/${b.drxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return NextResponse.json({ error: t.slice(0, 300) || `drx patch ${res.status}` }, { status: 502 });
      }
      return NextResponse.json({ drxId: b.drxId, updated: true });
    }
    const res = await fetch(`${base}/api/v1/facilities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: { success?: boolean; data?: { id?: number }; error?: { message?: string } } = {};
    try { json = JSON.parse(text); } catch { /* keep empty */ }
    if (!res.ok || !json?.data?.id) {
      return NextResponse.json({ error: json?.error?.message || text.slice(0, 300) || `drx ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ drxId: json.data.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
