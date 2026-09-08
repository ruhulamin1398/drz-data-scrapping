import { NextResponse } from "next/server";
import { readGroups } from "@/lib/facilitiesFile";

export async function GET() {
  try {
    return NextResponse.json({ groups: readGroups() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
