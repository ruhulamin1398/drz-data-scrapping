// Shared tag normalisation for cron jobs (used by server APIs + the tag input).
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 32;

export function normalizeTag(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .slice(0, MAX_TAG_LENGTH);
}

export function normalizeTags(input: unknown): string[] {
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
