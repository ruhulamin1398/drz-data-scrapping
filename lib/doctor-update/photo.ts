// Photo update utility (pilot). Independent: decides its own source (raw HTML
// og:image via fetchDoctorPhoto), never touches structure_md, no AI needed.
import { fetchDoctorPhoto } from "../doctor";
import { throttle } from "./throttle";
import type { PhotoOptions, PhotoOutcome, UpdateCtx } from "./types";

// Outbound pacing: max 1 request per 3s across all photo-update callers in this
// process (DRX GET + source scrape + DRX PATCH share one lane).
const GAP_MS = 3000;
const LANE = "photo-update";

function drxBase(): string {
  return (process.env.DRX_API_BASE || "https://api.doctorzonebd.com").replace(/\/$/, "");
}

function drxToken(): string {
  const t = process.env.DRX_ADMIN_TOKEN || "";
  if (!t) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
  return t;
}

// Current hosted photo on DRX ("" when missing). Read-only, cheap.
export async function getCurrentPhoto(drxId: string): Promise<string> {
  await throttle(LANE, GAP_MS);
  const res = await fetch(`${drxBase()}/api/v1/doctors/${drxId}`, {
    headers: { Authorization: `Bearer ${drxToken()}` },
  });
  if (!res.ok) throw new Error(`drx get ${res.status}`);
  const json = await res.json().catch(() => null);
  const d = json?.data ?? {};
  return String(d.photo ?? "").trim();
}

// Fresh scrape of the source page (og:image). Utility-owned source decision.
export async function resolvePhoto(sourceUrl: string): Promise<string> {
  await throttle(LANE, GAP_MS);
  return (await fetchDoctorPhoto(sourceUrl)).trim();
}

function sameUrl(a: string, b: string): boolean {
  return a.trim() === b.trim() && a.trim() !== "";
}

// Decide skipped vs update. Throws when photo cannot be resolved (failed run).
export async function updatePhoto(ctx: UpdateCtx, opts: PhotoOptions): Promise<PhotoOutcome> {
  if (!ctx.drxId) throw new Error("drxId required for photo update (push first via /doctors)");
  const prevPhoto = await getCurrentPhoto(ctx.drxId);
  if (opts.skipIfPhotoExists && prevPhoto) {
    return { action: "skipped", reason: "photo exists, skip flag on", prevPhoto };
  }
  const fresh = await resolvePhoto(ctx.sourceUrl);
  if (!fresh) throw new Error("no photo found on source page (og:image missing)");
  if (prevPhoto && sameUrl(prevPhoto, fresh)) {
    return { action: "skipped", reason: "same photo url, no-op", prevPhoto };
  }
  return { action: "update", prevPhoto, newPhoto: fresh };
}

// Persist: backend re-hosts photoUrl to R2 (verified 2026-10-10). Never hotlink via `photo`.
export async function applyPhoto(drxId: string, photoUrl: string): Promise<void> {
  await throttle(LANE, GAP_MS);
  const res = await fetch(`${drxBase()}/api/v1/doctors/${drxId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${drxToken()}` },
    body: JSON.stringify({ photoUrl }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t.slice(0, 300) || `drx patch ${res.status}`);
  }
}
