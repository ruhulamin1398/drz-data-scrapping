// Doctor pipeline (Sylhet pilot): profile page -> nex-router JSON extract -> DRX doctor + degrees.
// Chambers have no doctor-link field on the backend (CreateChamberDto lacks doctorId),
// so chamber blocks are stored as structured text in extraInformation until backend adds it.
import { fetchSource } from "./scrape";

export type DoctorDegree = { title: string; subject?: string; institution?: string; country?: string };
export type DoctorChamber = {
  facilityName: string; address?: string; serialTime?: string;
  serialContactNumber?: string; workingDays?: Record<string, string[]>;
};
export type ExtractedDoctor = {
  name: string; designation?: string; specialityArea?: string;
  degrees: DoctorDegree[]; workingIn?: string; phones: string[];
  email?: string; biography?: string; chambers: DoctorChamber[];
};
export type DrxDoctor = ExtractedDoctor & { departmentIds: string[]; sourceUrl: string; drxId?: string };

// Step 1: profile pages are small (~2KB) — always fetch full, no trim.
// Retries once on transient 503 (jina upstream hiccups).
export async function fetchDoctorProfile(url: string): Promise<string> {
  try {
    return (await fetchSource(url, true)).trimmed;
  } catch (e) {
    if (!/503/.test(e instanceof Error ? e.message : String(e))) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return (await fetchSource(url, true)).trimmed;
  }
}

// Step 2: fixed-prompt JSON extraction via nex-router (gemini, temperature 0).
export async function extractDoctor(md: string, deptSlug: string, deptName: string): Promise<ExtractedDoctor> {
  const nexUrl = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/v1/chat/completions";
  const model = process.env.NEX_MODEL || "gemini";
  if (!md) throw new Error("profile content required");
  const prompt =
`You extract doctor information. Output ONLY a JSON object, no reasoning, no markdown fences, no explanation.

Rules:
- name: full name WITH title exactly as shown (e.g. "Dr. Md. Sirajur Rahman Sarwar", "Prof. Dr. Shishir Basak").
- designation: job title only (e.g. "Assistant Professor", "Professor"). Empty string if absent.
- specialityArea: the site's Specialties section as free text (e.g. "Cardiology and Medicine Specialist"). Empty string if absent.
- degrees: split the degree line on commas. Each item: title (e.g. "MBBS"), subject (text in inner parentheses if any, else ""), institution (text after degree in parentheses like DMC/BSMMU/DU or named college, else ""), country (only if explicitly stated, else "").
- workingIn: STRICTLY lowercase "designation, ${deptSlug}, institution" (exactly two commas, e.g. "assistant professor, ${deptSlug}, sylhet mag osmani medical college hospital"). Use the workplace/college line as institution. Empty string if no workplace.
- phones: appointment/serial numbers as written (e.g. "+8801601655913"). [] if none.
- email: "" if absent.
- biography: the descriptive paragraph about the doctor. "" if absent.
- chambers: one entry per "Chamber 0N & Appointment" block: facilityName (chamber/hospital name), address (Address line), serialTime (Visiting Hour line as written), serialContactNumber (Appointment number). workingDays: object with ALL 7 keys Sunday..Saturday; each an array of "HH:MM" 24h start/end pairs derived from serialTime (e.g. "3pm to 5pm" -> ["15:00","17:00"]); closed or unknown days -> []. [] if no chamber blocks.

Department context: slug "${deptSlug}", title "${deptName}".

Content:
` + md;
  const res = await fetch(nexUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 2500, temperature: 0.0, stream: false }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`extract failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  let raw: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
  // Second attempt when the model wraps output in fences or truncates it.
  if (!looksJson(raw)) {
    await new Promise((r) => setTimeout(r, 1000));
    const res2 = await fetch(nexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt + "\nReturn ONLY the JSON object." }], max_tokens: 2500, temperature: 0.0, stream: false }),
    });
    if (!res2.ok) throw new Error(`extract failed: ${res2.status}`);
    const data2 = await res2.json();
    raw = data2?.choices?.[0]?.message?.content?.trim() ?? "";
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`extract not JSON: ${raw.slice(0, 150)}`);
  let d: Partial<ExtractedDoctor>;
  try {
    d = JSON.parse(raw.slice(start, end + 1)) as Partial<ExtractedDoctor>;
  } catch (e) {
    throw new Error(`extract bad JSON: ${e instanceof Error ? e.message : String(e)} :: ${raw.slice(Math.max(0, start), start + 200)}`);
  }
  if (!d.name || !String(d.name).trim() || /<.*>/.test(String(d.name))) throw new Error("name empty from model");
  return {
    name: String(d.name).trim(),
    designation: String(d.designation ?? "").trim(),
    specialityArea: String(d.specialityArea ?? "").trim(),
    degrees: Array.isArray(d.degrees) ? d.degrees.filter((x) => x && x.title).map((x) => ({
      title: String(x.title).trim(), subject: String(x.subject ?? "").trim(),
      institution: String(x.institution ?? "").trim(), country: String(x.country ?? "").trim(),
    })) : [],
    workingIn: String(d.workingIn ?? "").trim(),
    phones: Array.isArray(d.phones) ? d.phones.map(String).map((s) => s.trim()).filter(Boolean) : [],
    email: String(d.email ?? "").trim(),
    biography: String(d.biography ?? "").trim(),
    chambers: Array.isArray(d.chambers) ? d.chambers.filter((x) => x && x.facilityName).map((x) => ({
      facilityName: String(x.facilityName).trim(), address: String(x.address ?? "").trim(),
      serialTime: String(x.serialTime ?? "").trim(), serialContactNumber: String(x.serialContactNumber ?? "").trim(),
      workingDays: x.workingDays && typeof x.workingDays === "object" ? x.workingDays : undefined,
    })) : [],
  };
}

// Site specialty titles (same as seeded departments) for the extraction prompt.
const DEPT_TITLES: Record<string, string> = {
  "anesthesiologist": "Anesthesiologist", "oncologist": "Cancer Specialist",
  "cardiac-surgeon": "Cardiac Surgeon", "cardiologist": "Cardiologist",
  "chest-specialist": "Chest Specialist", "pediatrician": "Child Specialist",
  "colorectal-surgeon": "Colorectal Surgeon", "dentist": "Dentist",
  "endocrinologist": "Endocrinologist", "otolaryngologist": "ENT Specialist",
  "homeopathic": "Homeopathic Doctor", "ophthalmologist": "Eye Specialist",
  "gastroenterologist": "Gastroenterologist", "general-surgeon": "General Surgeon",
  "gynecologist": "Gynecologist", "hematologist": "Hematologist",
  "infertility-specialist": "Infertility Specialist", "nephrologist": "Nephrologist",
  "hepatologist": "Hepatologist", "medicine-specialist": "Medicine Specialist",
  "neurologist": "Neurologist", "neurosurgeon": "Neurosurgeon",
  "orthopedic-specialist": "Orthopedic Surgeon", "pediatric-surgeon": "Pediatric Surgeon",
  "physical-medicine-specialist": "Physical Medicine", "plastic-surgeon": "Plastic Surgeon",
  "psychiatrist": "Psychiatrist", "rheumatologist": "Rheumatologist",
  "sexologist": "Sex Specialist", "dermatologist": "Dermatologist",
  "urologist": "Urologist", "vascular-surgeon": "Vascular Surgeon",
};

export function deptTitle(slug: string): string {
  return DEPT_TITLES[slug] ?? slug;
}

function looksJson(s: string): boolean {
  const t = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return t.startsWith("{") && t.endsWith("}");
}

// Backend rejects malformed optionals outright — sanitize instead of failing the row.
function validWorkingIn(s: string): boolean {
  return /^[^,]+,\s*[^,]+,\s*[^,]+$/.test(s.trim());
}

export function chamberText(chambers: DoctorChamber[]): string {  return chambers.map((c, i) =>
    `Chamber ${i + 1}: ${c.facilityName}${c.address ? ` | ${c.address}` : ""}${c.serialTime ? ` | ${c.serialTime}` : ""}${c.serialContactNumber ? ` | ${c.serialContactNumber}` : ""}`
  ).join("\n");
}

// Step 3: POST doctor, then POST each degree with doctorId. Update in place when drxId given.
export async function pushDoctor(d: DrxDoctor): Promise<{ drxId: string; updated?: boolean; degrees: number }> {
  const base = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
  const token = process.env.DRX_ADMIN_TOKEN || "";
  if (!token) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
  if (!d.name || !d.departmentIds.length) throw new Error("name + departmentIds required");
  const extra = [chamberText(d.chambers), `Source: ${d.sourceUrl}`].filter(Boolean).join("\n");
  const payload = {
    name: d.name, designation: d.designation || undefined,
    specialityArea: d.specialityArea || undefined, departmentIds: d.departmentIds,
    workingIn: d.workingIn && validWorkingIn(d.workingIn) ? d.workingIn.toLowerCase() : undefined,
    phones: d.phones.length ? d.phones : undefined,
    email: d.email && /@/.test(d.email) ? d.email : undefined,
    biography: d.biography || undefined,
    extraInformation: extra || undefined,
  };
  let drxId: string; let updated = false;
  if (d.drxId) {
    await patchDoctor(base, token, d.drxId, payload);
    drxId = d.drxId; updated = true;
  } else {
    const res = await fetch(`${base}/api/v1/doctors`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: { success?: boolean; data?: { id?: string }; error?: { message?: string; details?: unknown } } = {};
    try { json = JSON.parse(text); } catch { /* keep empty */ }
    if (!res.ok || !json?.data?.id) {
      const details = JSON.stringify(json?.error?.details ?? "").slice(0, 200);
      const msg = [json?.error?.message || text.slice(0, 200) || `drx ${res.status}`, details].filter((x) => x && x !== '""').join(" | ");
      if (/already exists/i.test(msg)) {
        const found = await findDoctorByName(base, token, d.name);
        if (found) { await patchDoctor(base, token, found, payload); drxId = found; updated = true; }
        else throw new Error(msg);
      } else throw new Error(msg);
    } else drxId = json.data.id as string;
  }
  let degrees = 0;
  for (const g of d.degrees) {
    const r = await fetch(`${base}/api/v1/degrees`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        doctorId: String(drxId), title: g.title,
        subject: g.subject || undefined, institution: g.institution || undefined, country: g.country || undefined,
      }),
    });
    if (r.ok) degrees++;
  }
  return { drxId: drxId!, updated: updated || undefined, degrees };
}

async function findDoctorByName(base: string, token: string, name: string): Promise<string | null> {
  const res = await fetch(`${base}/api/v1/doctors?search=${encodeURIComponent(name)}&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const items: { id: string; name: string }[] = json?.data?.items ?? [];
  const target = name.trim().toLowerCase();
  return items.find((it) => it.name?.trim().toLowerCase() === target)?.id ?? null;
}

async function patchDoctor(base: string, token: string, id: string, payload: object): Promise<void> {
  const res = await fetch(`${base}/api/v1/doctors/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t.slice(0, 300) || `drx patch ${res.status}`);
  }
}
