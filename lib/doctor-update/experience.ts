// Experience update utility (search-grounded). Independent: owns its source
// decision — uses gemma-search (google_search) to find the doctor's experience,
// calculates years from career dates when needed, handles missing/conflicting
// data. Updates DRX `experienced_year`.
import { throttle } from "./throttle";
import type { ExperienceOptions, ExperienceOutcome, UpdateCtx } from "./types";

const GAP_MS = 3000;
const LANE = "experience-update";

function drxBase(): string {
  return (process.env.DRX_API_BASE || "https://api-9028.doctorzonebd.com").replace(/\/$/, "");
}

function drxToken(): string {
  const t = process.env.DRX_ADMIN_TOKEN || "";
  if (!t) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
  return t;
}

const NEX_URL = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/rest/gemma-search";
const NEX_MODEL = process.env.NEX_MODEL || "gemini";

// Current DRX profile (experience + identity for the search prompt).
export type DrxDoctorProfile = {
  experienced_year: string; name: string; designation: string; specialityArea: string;
  workingIn: string; degrees: { title?: string; subject?: string; institution?: string }[];
};

export async function getDrxDoctor(drxId: string): Promise<DrxDoctorProfile> {
  await throttle(LANE, GAP_MS);
  const res = await fetch(`${drxBase()}/api/v1/doctors/${drxId}`, {
    headers: { Authorization: `Bearer ${drxToken()}` },
  });
  if (!res.ok) throw new Error(`drx get ${res.status}`);
  const json = await res.json().catch(() => null);
  const d = json?.data ?? {};
  return {
    experienced_year: String(d.experienced_year ?? "").trim(),
    name: String(d.name ?? "").trim(),
    designation: String(d.designation ?? "").trim(),
    specialityArea: String(d.specialityArea ?? "").trim(),
    workingIn: String(d.workingIn ?? "").trim(),
    degrees: Array.isArray(d.degrees) ? d.degrees : [],
  };
}

// Current experienced_year on DRX ("" when missing).
export async function getCurrentExperience(drxId: string): Promise<string> {
  return (await getDrxDoctor(drxId)).experienced_year;
}

// Search-grounded experience resolution via gemma-search.
// Returns years as a string, or throws when nothing reliable is found.
async function searchExperience(doctorName: string, sourceUrl: string): Promise<string> {
  const prompt = `You are a medical-directory data researcher. Find the total years of professional experience for the doctor named "${doctorName}".

Search the web for this doctor's profile, CV, biography, or any page mentioning their work history. The doctor's profile page is: ${sourceUrl}

Rules:
- Look for explicit statements like "X+ years of experience", "X years of experience", or "since YYYY".
- If only career dates are given (e.g., "started practice in 2010", "MBBS in 2005"), calculate years from that start year to 2026.
- If multiple conflicting numbers appear, pick the most specific/recent one and note the reasoning.
- If no experience information is found anywhere, respond with exactly: NOT_FOUND
- If found, respond with ONLY the number (e.g., "15"), no explanation, no units.

Respond with ONLY the number or NOT_FOUND.`;

  await throttle(LANE, GAP_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res: Response;
  try {
    res = await fetch(NEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(`gemma-search request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`gemma-search failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  // parts[0] is the model's thinking trace ({ thought: true }) — the real
  // answer is in the non-thought text part(s). Never parse the thought.
  const parts: { text?: string; thought?: boolean }[] =
    data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => p && typeof p.text === "string" && !p.thought)
    .map((p) => String(p.text).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text || /NOT_FOUND/i.test(text)) {
    throw new Error("no experience found via search");
  }
  const m = text.match(/(\d{1,2})/);
  if (!m) throw new Error(`unparseable experience response: ${text.slice(0, 100)}`);
  const years = Number(m[1]);
  if (years < 0 || years > 60) throw new Error(`implausible experience years: ${years}`);
  return String(years);
}

// Build the search identity from everything the database knows: queue row
// (name, specialty, card entry with degrees + workplace) + DRX profile
// (designation, degrees with institutions, workingIn institution).
function buildIdentity(ctx: UpdateCtx, drx: DrxDoctorProfile): string {
  const name = ctx.doctorName?.trim() || drx.name;
  if (!name) throw new Error("doctor name missing from database (doctor_queue + DRX)");
  const designation = ctx.designation?.trim() || drx.designation;
  const speciality = ctx.speciality?.trim() || drx.specialityArea;
  const quals = drx.degrees
    .map((g) => [g.title, g.subject ? `(${g.subject})` : "", g.institution].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  const institutions = [...new Set(drx.degrees.map((g) => String(g.institution ?? "").trim()).filter(Boolean))];
  const workingInInst = drx.workingIn.split(",").map((s) => s.trim()).filter(Boolean)[2];
  if (workingInInst) institutions.unshift(workingInInst);
  const bits = [
    name,
    designation, speciality,
    quals.length ? `qualifications: ${quals.join(", ")}` : "",
    institutions.length ? `institution: ${institutions.join("; ")}` : "",
    ctx.cardText?.trim() ? `directory card: ${ctx.cardText.trim().replace(/\s+/g, " ").slice(0, 400)}` : "",
  ].filter(Boolean);
  return bits.join("; ");
}

// Decide skipped vs update. Throws when experience cannot be resolved.
// Identity comes from the database (doctor_queue row + DRX profile) — never
// from the URL slug, so the search prompt always carries the real name.
export async function updateExperience(ctx: UpdateCtx, opts: ExperienceOptions): Promise<ExperienceOutcome> {
  if (!ctx.drxId) throw new Error("drxId required for experience update (push first via /doctors)");
  const drx = await getDrxDoctor(ctx.drxId);
  const prevValue = drx.experienced_year;
  if (opts.skipIfExperienceSet && prevValue) {
    return { action: "skipped", reason: "experience already set, skip flag on", prevValue };
  }
  const identity = buildIdentity(ctx, drx);
  const years = await searchExperience(identity, ctx.sourceUrl);
  if (prevValue && prevValue === years) {
    return { action: "skipped", reason: "same experience value, no-op", prevValue };
  }
  return { action: "update", prevValue, newValue: years };
}

// Persist: PATCH experienced_year on DRX.
export async function applyExperience(drxId: string, years: string): Promise<void> {
  await throttle(LANE, GAP_MS);
  const res = await fetch(`${drxBase()}/api/v1/doctors/${drxId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${drxToken()}` },
    body: JSON.stringify({ experienced_year: years }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t.slice(0, 300) || `drx patch ${res.status}`);
  }
}
