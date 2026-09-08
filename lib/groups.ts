export type GroupItem = { title: string; url: string };
export type Group = {
  key: string;
  division: string;
  divisionId: number;
  district?: string;
  districtId?: number;
  items: GroupItem[];
};

// Headers look like:
//   ## Sylhet (id:41)
//   ## Dhaka(id:34) : district 205. Narayanganj
export function parseFacilitiesMd(text: string): Group[] {
  const groups: Group[] = [];
  const headerRe = /^##\s*(.+?)\s*\(id:(\d+)\)\s*(?::\s*district\s+(\d+)\.\s*(.+?))?\s*$/;
  const itemRe = /^\*\s+\[(.+?)\]\((https?:\/\/[^)]+)\)/;
  let cur: Group | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const h = line.match(headerRe);
    if (h) {
      const key = `${h[2]}-${h[3] ?? "main"}`;
      const found = groups.find((g) => g.key === key);
      if (found) {
        cur = found;
      } else {
        cur = {
          key,
          division: h[1].trim(),
          divisionId: Number(h[2]),
          district: h[4]?.trim() || undefined,
          districtId: h[3] ? Number(h[3]) : undefined,
          items: [],
        };
        groups.push(cur);
      }
      continue;
    }
    const m = line.match(itemRe);
    if (m && cur) cur.items.push({ title: m[1].trim(), url: m[2].trim() });
  }
  return groups.filter((g) => g.items.length > 0);
}

// Best-effort facility type from title (drz backend catalog):
// 40 Medical College Hospital, 54 Private Hospital / Clinic,
// 66 Specialized Hospital, 14 Consultancy & Diagnostic Center
export function inferTypeId(title: string): number {
  const t = title.toLowerCase();
  if (t.includes("medical college") || t.includes("medical university")) return 40;
  if (
    t.includes("specialized") || t.includes("specialised") || t.includes("eye") ||
    t.includes("cancer") || t.includes("heart") || t.includes("cardiac") ||
    t.includes("kidney") || t.includes("neuro") || t.includes("orthopedic") ||
    t.includes("ent") || t.includes("mental")
  ) return 66;
  if (t.includes("diagnostic") || t.includes("consultation") || t.includes("clinic") || /\blab\b/.test(t)) return 14;
  return 54;
}