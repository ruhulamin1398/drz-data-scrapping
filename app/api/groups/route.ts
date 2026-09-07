import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseFacilitiesMd } from "@/lib/groups";

// Reads the live facilities.md next to the app (edit the file, reload the page)
export async function GET() {
  try {
    const file = path.join(process.cwd(), "..", "facilities.md");
    const text = fs.readFileSync(file, "utf8");
    const groups = parseFacilitiesMd(text).map((g) => ({ ...g, items: g.items }));
    return NextResponse.json({ groups });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
