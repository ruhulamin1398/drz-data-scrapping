import { NextRequest, NextResponse } from "next/server";
import { extractDoctor, extractDoctorAuto, deptTitle } from "@/lib/doctor";

// POST { markdown, specialty?, card? } — nex-router settings come from env only.
// specialty omitted (source-URL-only row) → auto-resolve specialty + departments
// from the content; response then includes specialtySlug + departmentIds.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.markdown) {
      return NextResponse.json({ error: "markdown required" }, { status: 400 });
    }
    if (body.specialty) {
      const doctor = await extractDoctor(body.markdown, body.specialty, deptTitle(body.specialty), body.card);
      return NextResponse.json({ doctor });
    }
    const auto = await extractDoctorAuto(body.markdown, body.card);
    return NextResponse.json({ doctor: auto.doctor, specialtySlug: auto.specialtySlug, departmentIds: auto.departmentIds });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("required") || msg.includes("empty") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
