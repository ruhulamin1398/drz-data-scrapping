import { NextRequest, NextResponse } from "next/server";
import { fetchDoctorPhoto } from "@/lib/doctor";

// POST { url } → { photo }. Never fails the row: "" means "no photo"
// (many doctors genuinely have none). Retried internally (3 attempts).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.url) {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }
    const photo = await fetchDoctorPhoto(body.url);
    return NextResponse.json({ photo });
  } catch (e: unknown) {
    return NextResponse.json({ photo: "" });
  }
}
