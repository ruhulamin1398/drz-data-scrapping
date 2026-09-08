import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseFacilitiesMd } from "@/lib/groups";

// Reads facilities.md bundled with the app (data/facilities.md — refresh with
// `pnpm sync:md`), falling back to the working copy next to the app for local dev.
export async function GET() {
  try {
    const bundled = path.join(process.cwd(), "data", "facilities.md");
    const local = path.join(process.cwd(), "..", "facilities.md");
    const file = fs.existsSync(bundled) ? bundled : local;
    const text = fs.readFileSync(file, "utf8");
    const groups = parseFacilitiesMd(text).map((g) => ({ ...g, items: g.items }));
    return NextResponse.json({ groups });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
