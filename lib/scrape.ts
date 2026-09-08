import { locationBlock } from "./locations";

const TRIM_LINES = 30;

// Step 1: fetch a facility page through jina.ai. full=true returns everything,
// otherwise only the first TRIM_LINES lines (drops the doctor-list noise).
export async function fetchSource(url: string, full: boolean): Promise<{ totalLines: number; trimmed: string; full: boolean }> {
  const jinaKey = process.env.JINA_API_KEY || "";
  if (!url) throw new Error("url required");
  if (!jinaKey) throw new Error("JINA_API_KEY missing in .env.local");
  const target = url.startsWith("https://r.jina.ai/") ? url : `https://r.jina.ai/${url}`;
  const res = await fetch(target, { headers: { Authorization: `Bearer ${jinaKey}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fetch failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const raw = await res.text();
  const lines = raw.split("\n");
  return { totalLines: lines.length, trimmed: full ? raw : lines.slice(0, TRIM_LINES).join("\n"), full };
}

// Step 2: extract the 6-line facility record via nex-router (gemini, fixed prompt).
export async function extractInfo(trimmed: string, divisionId: number): Promise<string> {
  const nexUrl = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/v1/chat/completions";
  const model = process.env.NEX_MODEL || "gemini";
  if (!trimmed) throw new Error("trimmed content required");
  const prompt =
`You extract facility information. Output ONLY the result, no reasoning, no explanation.

Location information:
${locationBlock(divisionId)}

Extract from content below and output EXACTLY these 6 lines, nothing else:
name: <facility name>
fullAddress: <full street address from Address line>
phones: ["...", "..."]
extraInformation: "<1-2 sentence Bengali description from content, not doctor list>"
divisionId: ${divisionId}
districtId: <match district from address using ids above>

Content:
` + trimmed;
  const res = await fetch(nexUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 800, temperature: 0.0, stream: false }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`extract failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

export type DrxFacility = {
  name: string; divisionId: number; districtId: number; typeId: number;
  fullAddress: string; phones: string[]; extraInformation: string; drxId?: number;
};

// Step 3: create on drx-backend, or PATCH in place when drxId is given (no duplicates).
export async function pushDrx(f: DrxFacility): Promise<{ drxId: number; updated?: boolean }> {
  const base = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
  const token = process.env.DRX_ADMIN_TOKEN || "";
  if (!token) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
  if (!f.name || !f.divisionId || !f.districtId || !f.typeId) throw new Error("name, divisionId, districtId, typeId required");
  const payload = {
    name: f.name, divisionId: f.divisionId, districtId: f.districtId, typeId: f.typeId,
    fullAddress: f.fullAddress || "", phones: f.phones || [], extraInformation: f.extraInformation || "",
  };
  if (f.drxId) {
    const res = await fetch(`${base}/api/v1/facilities/${f.drxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t.slice(0, 300) || `drx patch ${res.status}`);
    }
    return { drxId: f.drxId, updated: true };
  }
  const res = await fetch(`${base}/api/v1/facilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: { success?: boolean; data?: { id?: number }; error?: { message?: string } } = {};
  try { json = JSON.parse(text); } catch { /* keep empty */ }
  if (!res.ok || !json?.data?.id) throw new Error(json?.error?.message || text.slice(0, 300) || `drx ${res.status}`);
  return { drxId: json.data.id };
}
