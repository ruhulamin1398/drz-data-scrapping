// Doctor pipeline (Sylhet pilot): profile page -> nex-router JSON extract -> DRX doctor + degrees.
// Chambers have no doctor-link field on the backend (CreateChamberDto lacks doctorId),
// so chamber blocks are stored as structured text in extraInformation until backend adds it.
import { fetchSource } from "./scrape";
import { formatExamples } from "./doctor-examples";

export type DoctorDegree = { title: string; subject?: string; institution?: string; country?: string };
export type DoctorChamber = {
  facilityName: string; address?: string; serialTime?: string;
  serialContactNumber?: string; workingDays?: Record<string, string[]>;
};
export type ExtractedDoctor = {
  name: string; designation?: string; specialityArea?: string; bmdcRegNo?: string;
  degrees: DoctorDegree[]; workingIn?: string; phones: string[];
  email?: string; biography?: string; extraInformation?: string;
  gender?: string; website?: string; chambers: DoctorChamber[];
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
// name, designation and workingIn are REQUIRED — empty/malformed values throw.
// cardText is the specialty-page card entry; it sometimes holds the BMDC Reg. No.
export async function extractDoctor(md: string, deptSlug: string, deptName: string, cardText?: string): Promise<ExtractedDoctor> {
  const nexUrl = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/v1/chat/completions";
  const model = process.env.NEX_MODEL || "gemini";
  if (!md) throw new Error("profile content required");
  // Full prompt: rules + schema + two worked examples (~6k tokens — fine for 250k ctx).
  // Lean prompt: same rules, no examples. Used as fallback when the model echoes
  // the long prompt instead of answering (different stimulus breaks the loop).
  const promptFull = `Role: You are a precise medical-directory data extractor. Input is Jina markdown of one doctor profile page from doctorbangladesh.com (title line, "Chamber 0N & Appointment" blocks, then a descriptive paragraph), plus the doctor's card entry from the specialty list page. Page-top nav/search boilerplate and any Bengali ticket-booking notice ("টিকিট নেয়ার নিয়ম") are noise — ignore them, except a personal website link which goes to "website".

Output contract: respond with ONLY one JSON object with exactly these keys: name, designation, specialityArea, bmdcRegNo, gender, website, degrees (array of {title,subject,institution,country}), workingIn, phones (array), email, biography, extraInformation, chambers (array of {facilityName,address,serialTime,serialContactNumber,workingDays}). No reasoning, no markdown fences, no commentary, no trailing text. Missing values become "" (strings) or [] (arrays) — never null, never placeholders like "N/A", "<...>", "unknown".

Field rules:
- name: full name WITH title exactly as shown in the Title line (e.g. "Dr. Md. Sirajur Rahman Sarwar", "Prof. Dr. Shishir Basak"). REQUIRED — never empty.
- designation: job title only, Title Case (e.g. "Assistant Professor", "Professor", "Consultant", "Associate Professor of Oncology"). REQUIRED — never empty; if no explicit title, derive it from the workplace line ("... serves as X at ..." / "He is a Consultant ..."); last resort: "General Practitioner".
- specialityArea: the "X Specialist" line from card or profile (e.g. "Cardiology and Medicine Specialist", "Anesthesiology, Pain Management & Critical Care Medicine Specialist"). Fallback: "${deptName} Specialist". "" only if nothing found.
- bmdcRegNo: digits/letter code from a "BMDC Reg. No:" line, usually only in the card entry (e.g. "A-36739"). "" if absent.
- gender: "male" if the bio uses He/His, "female" if She/Her, else "".
- website: the doctor's own external website URL if linked (personal domain). "" if absent. Never a doctorbangladesh.com, google, or tel: link.
- degrees: split the qualification line on commas, one object per degree. title = degree abbreviation ("MBBS", "MD", "DA", "MCPS", "M.Phil", "FCPS", "D-CARD", "BCS"). subject = inner-parenthesis specialty ("Cardiology" in "MD (Cardiology)", "Anesthesiology" in "MCPS (Anesthesiology)", else ""). institution = awarding body in parentheses ("DMC", "DU", "BSMMU", "BMU", "UK", "USA") or a named college, else "". country = only when explicitly stated (e.g. "MCCP (USA)" -> country "USA"), else "". Strip prefixes like "BCS (Health)" -> title "BCS", subject "Health".
- workingIn: STRICTLY lowercase "designation, ${deptSlug}, institution" with EXACTLY two commas total — never write a comma inside the designation or institution (replace with a space, e.g. "sylhet mag osmani medical college hospital sylhet"). Middle segment EXACTLY "${deptSlug}". Example: "assistant professor, ${deptSlug}, sylhet mag osmani medical college hospital". REQUIRED — never empty.
- phones: every Appointment/serial/Call-Now number exactly as written with country code (e.g. "+8801601655913"). Dedupe. [] if none. Never chamber landlines without codes altered — copy verbatim.
- email: "" unless an email address is literally shown.
- biography: always "" (the paragraph goes to extraInformation).
- extraInformation: the FULL descriptive paragraph about the doctor, copied completely, never summarized. "" if absent.
- chambers: one entry per "Chamber 0N & Appointment" block, in order. facilityName = bold chamber/hospital name WITHOUT markdown links. address = Address line text only. serialTime = Visiting Hour line copied VERBATIM (e.g. "5pm to 10pm (Closed: Sat & Friday)"). serialContactNumber = Appointment number verbatim, "" if none.
- workingDays: ALL 7 keys Sunday..Saturday, each an array of ["start","end"] in 24h "HH:MM" converted from serialTime. Convert: 3pm->15:00, 5pm->17:00, 10pm->22:00, 10am->10:00, 8pm->20:00, "10:30am"->"10:30", "7:30pm"->"19:30". Closed-day words map: Friday/Fri, Saturday/Sat, Thursday/Thu, Sunday/Sun, Monday/Mon, Tuesday/Tue, Wednesday/Wed. "(Closed: Friday)" empties Friday only; "(Closed: Sat & Friday)" empties both; "(Closed: Thu & Friday)" empties both; "(Closed: Friday)" keeps Saturday. Days with no hours mentioned -> []. Values are ARRAYS OF STRINGS ONLY — never booleans, never null. [] (no chamber blocks at all) -> "chambers": [].

Department context: slug "${deptSlug}", title "${deptName}".
${cardText ? `Card list entry (degrees line, may contain the BMDC Reg. No):\n` + cardText + `\n` : ""}
Study these two complete worked examples first — your output must follow the same shape and conventions:
${formatExamples()}

Now extract from the following real page. Begin your response with { and end with }. Output ONLY the JSON object — no explanations, no repetition of these instructions. Content:
` + md;
  const promptLean =
`Extract doctor info from the Jina markdown below. Output ONLY one JSON object, no fences, no commentary. Missing values are "" or [].
Keys: name (full name WITH title, REQUIRED), designation (job title, REQUIRED, Title Case), specialityArea (X Specialist line), bmdcRegNo (from BMDC Reg. No line), gender (male/female from He-She pronouns), website (doctor's own external URL only), degrees (split qualification commas into {title,subject,institution,country}), workingIn (REQUIRED, lowercase "designation, ${deptSlug}, institution" with exactly two commas, no commas inside segments), phones (appointment numbers verbatim), email, biography (always ""), extraInformation (full descriptive paragraph), chambers ([{facilityName, address, serialTime verbatim, serialContactNumber, workingDays with all 7 day keys Sunday..Saturday mapping to [start,end] 24h HH:MM arrays, closed days []}]).
Dept: slug "${deptSlug}", title "${deptName}".
${cardText ? `Card entry:\n` + cardText + `\n` : ""}
Content:
` + md;
  async function callModel(prompt: string): Promise<string> {
    const res = await fetch(nexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 3000, temperature: 0.0, stream: false }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`extract failed: ${res.status} ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  }
  // Attempt 1: full prompt with examples. Attempt 2 (echo/garbage): lean prompt.
  let raw = await callModel(promptFull);
  if (!looksJson(raw) || !tryParse(raw)) {
    await new Promise((r) => setTimeout(r, 1000));
    raw = await callModel(promptLean + "\nReturn ONLY the JSON object.");
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`extract not JSON: ${raw.slice(0, 150)}`);
  const d = tryParse(raw.slice(start, end + 1));
  if (!d) {
    const probe = raw.slice(start, start + 200);
    throw new Error(`extract bad JSON :: ${probe}`);
  }
  if (!d.name || !String(d.name).trim() || /<.*>/.test(String(d.name))) throw new Error("name empty from model");
  if (!d.designation || !String(d.designation).trim()) throw new Error("designation empty from model");
  const workingIn = normalizeWorkingIn(String(d.workingIn ?? ""), deptSlug);
  if (!workingIn) throw new Error(`workingIn malformed from model: ${String(d.workingIn ?? "").slice(0, 100)}`);
  return {
    name: String(d.name).trim(),
    designation: String(d.designation).trim(),
    specialityArea: String(d.specialityArea ?? "").trim(),
    bmdcRegNo: String(d.bmdcRegNo ?? "").trim(),
    degrees: Array.isArray(d.degrees) ? d.degrees.filter((x) => x && x.title).map((x) => ({
      title: String(x.title).trim(), subject: String(x.subject ?? "").trim(),
      institution: String(x.institution ?? "").trim(), country: String(x.country ?? "").trim(),
    })) : [],
    workingIn,
    phones: Array.isArray(d.phones) ? d.phones.map(String).map((s) => s.trim()).filter(Boolean) : [],
    email: String(d.email ?? "").trim(),
    biography: "",
    extraInformation: String(d.extraInformation ?? "").trim(),
    gender: d.gender === "male" || d.gender === "female" ? d.gender : "",
    website: validWebsite(d.website),
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
  "breast-surgeon": "Breast Surgeon", "cancer-surgeon": "Cancer Surgeon",
  "diabetologist": "Diabetologist", "nutritionist": "Nutritionist",
  "neuro-ophthalmologist": "Neuro-ophthalmologist", "gynecological-oncologist": "Gynecological Oncologist",
  "pediatric-hematologist": "Pediatric Hematologist", "hepatobiliary-surgeon": "Hepatobiliary Surgeon",
  "doctor-normal-delivery": "Normal Delivery Specialist", "occupational-therapist": "Occupational Therapist",
  "pediatric-cardiologist": "Pediatric Cardiologist", "pediatric-gastroenterologist": "Pediatric Gastroenterologist",
  "pediatric-neurologist": "Pediatric Neurologist", "pediatric-neurosurgeon": "Pediatric Neurosurgeon",
  "pediatric-nephrologist": "Pediatric Nephrologist", "pediatric-ophthalmologist": "Pediatric Ophthalmologist",
  "pediatric-orthopedic-surgeon": "Pediatric Orthopedic", "pediatric-urologist": "Pediatric Urologist",
  "physiotherapist": "Physiotherapist", "psychologist": "Psychologist",
  "spine-surgeon": "Spine Surgeon", "best-child-psychiatrist": "Child & Adolescent Psychiatrist",
  "female-dentist": "Dentist (Female)", "orthodontist": "Orthodontist",
  "sonologist": "Sonologist",
};

export function deptTitle(slug: string): string {
  return DEPT_TITLES[slug] ?? slug;
}

function tryParse(s: string): Partial<ExtractedDoctor> | null {
  try {
    const v = JSON.parse(s) as Partial<ExtractedDoctor>;
    return v && typeof v === "object" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

function validWebsite(w: unknown): string {
  const s = String(w ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  if (/doctorbangladesh\.com|google\.com|tel:/i.test(s)) return "";
  return s;
}

function looksJson(s: string): boolean {
  const t = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return t.startsWith("{") && t.endsWith("}");
}

// Backend rejects malformed optionals outright — sanitize instead of failing the row.
// Backend wants exactly "designation, dept, institution" where NO segment may
// contain a comma (regex ^[^,]+,\s*[^,]+,\s*[^,]+$). Institutions do contain them
// ("... Hospital, Sylhet") — flatten extras to spaces, coerce the middle segment
// to our dept slug, lowercase everything.
function normalizeWorkingIn(s: string, deptSlug: string): string | null {
  const flat = (x: string) => x.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const segs = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (segs.length < 3 || !segs[0] || !segs[2]) return null;
  const desig = flat(segs[0]);
  const inst = flat(segs.slice(2).join(" "));
  if (!desig || !inst) return null;
  return `${desig}, ${deptSlug}, ${inst}`;
}

export function chamberText(chambers: DoctorChamber[]): string {
  return chambers.map((c, i) =>
    `Chamber ${i + 1}: ${c.facilityName}${c.address ? ` | ${c.address}` : ""}${c.serialTime ? ` | ${c.serialTime}` : ""}${c.serialContactNumber ? ` | ${c.serialContactNumber}` : ""}`
  ).join("\n");
}

// Step 3: POST doctor, then POST each degree with doctorId, then POST each chamber
// with doctorId + facilityId (matched) or facilityName (free text). Update in place when drxId given.
export async function pushDoctor(d: DrxDoctor): Promise<{ drxId: string; updated?: boolean; degrees: number; chambers: number }> {
  const base = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
  const token = process.env.DRX_ADMIN_TOKEN || "";
  if (!token) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
  if (!d.name || !d.departmentIds.length) throw new Error("name + departmentIds required");
  const extra = [d.extraInformation, chamberText(d.chambers), `Source: ${d.sourceUrl}`].filter(Boolean).join("\n");
  const payload = {
    name: d.name, designation: d.designation || undefined,
    specialityArea: d.specialityArea || undefined, bmdcRegNo: d.bmdcRegNo || undefined,
    departmentIds: d.departmentIds,
    workingIn: d.workingIn || undefined,
    phones: d.phones.length ? d.phones : undefined,
    email: d.email && /@/.test(d.email) ? d.email : undefined,
    gender: d.gender || undefined, website: d.website || undefined,
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
  const haveDegrees = d.degrees.length
    ? await existingDegreeTitles(base, token, String(drxId))
    : new Set<string>();
  for (const g of d.degrees) {
    if (haveDegrees.has(g.title.trim().toLowerCase())) continue; // retry-safe: no dupes
    const r = await fetch(`${base}/api/v1/degrees`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        doctorId: String(drxId), title: g.title,
        subject: g.subject || undefined, institution: g.institution || undefined, country: g.country || undefined,
      }),
    });
    if (r.ok) degrees++;
  }
  let chambers = 0;
  const haveChambers = d.chambers.length
    ? await existingChamberKeys(base, token, String(drxId))
    : new Set<string>();
  for (const [i, c] of d.chambers.entries()) {
    const facilityId = await findFacilityByName(base, token, c.facilityName);
    const key = chamberKey(facilityId, c.facilityName, c.serialTime);
    if (haveChambers.has(key)) continue; // retry-safe: no dupes
    const room = /room\s*(\d+)/i.exec(c.address ?? "");
    const r = await fetch(`${base}/api/v1/chambers`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        doctorId: String(drxId),
        ...(facilityId ? { facilityId } : { facilityName: c.facilityName }),
        roomNo: room ? Number(room[1]) : undefined,
        serialContactNumber: c.serialContactNumber || undefined,
        serialTime: c.serialTime || undefined,
        workingDays: cleanWorkingDays(c.workingDays),
        extraInformation: c.address || undefined,
        isPrimary: i === 0,
        sourceUrls: [d.sourceUrl],
      }),
    });
    if (r.ok) chambers++;
  }
  return { drxId: drxId!, updated: updated || undefined, degrees, chambers };
}

// workingDays must be day -> string[]; the model sometimes emits booleans.
// Coerce to the valid shape (unknown/closed days -> []).
function cleanWorkingDays(wd: Record<string, string[]> | undefined): Record<string, string[]> {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const out: Record<string, string[]> = {};
  for (const day of days) {
    const v = (wd as Record<string, unknown> | undefined)?.[day];
    out[day] = Array.isArray(v) ? v.map(String) : [];
  }
  return out;
}

function normFacility(s: string): string {
  return s.toLowerCase().replace(/,\s*sylhet\s*$/i, "").replace(/\s+/g, " ").trim();
}

function normKey(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function chamberKey(facilityId: number | null, facilityName: string | undefined, serialTime: string | undefined): string {
  return facilityId ? `id:${facilityId}` : `name:${normKey(facilityName)}|${normKey(serialTime)}`;
}

// Existing titles/keys for a doctor — retries skip what is already there.
async function existingDegreeTitles(base: string, token: string, doctorId: string): Promise<Set<string>> {
  const res = await fetch(`${base}/api/v1/degrees?doctorId=${doctorId}&page=1&limit=100&order=asc`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return new Set();
  const json = await res.json().catch(() => null);
  const items: { title?: string }[] = json?.data?.items ?? json?.data ?? [];
  return new Set((Array.isArray(items) ? items : []).map((x) => normKey(x.title)));
}

async function existingChamberKeys(base: string, token: string, doctorId: string): Promise<Set<string>> {
  const res = await fetch(`${base}/api/v1/chambers?doctorId=${doctorId}&page=1&limit=100&order=asc`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return new Set();
  const json = await res.json().catch(() => null);
  const items: { facilityId?: number; facilityName?: string; serialTime?: string }[] =
    json?.data?.items ?? json?.data ?? [];
  return new Set((Array.isArray(items) ? items : []).map((x) => chamberKey(x.facilityId ?? null, x.facilityName, x.serialTime)));
}

// Match a chamber name to an existing facility row (conservative: single normalized match).
async function findFacilityByName(base: string, token: string, name: string): Promise<number | null> {
  const res = await fetch(`${base}/api/v1/facilities?search=${encodeURIComponent(name)}&fields=id,name&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const items: { id: number; name: string }[] = json?.data?.items ?? [];
  const target = normFacility(name);
  const hits = items.filter((it) => normFacility(it.name ?? "") === target);
  return hits.length === 1 ? hits[0].id : null;
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
