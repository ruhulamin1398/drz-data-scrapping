import fs from "fs";
import path from "path";
import { parseFacilitiesMd, type Group } from "./groups";

// Single source for the facility list: bundled copy in the app,
// falling back to the working copy next to the app for local dev.
export function readGroups(): Group[] {
  const bundled = path.join(process.cwd(), "data", "facilities.md");
  const local = path.join(process.cwd(), "..", "facilities.md");
  const file = fs.existsSync(bundled) ? bundled : local;
  return parseFacilitiesMd(fs.readFileSync(file, "utf8"));
}
