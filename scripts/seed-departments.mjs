// Department seed (Sylhet pilot): node scripts/seed-departments.mjs (reads .env.local, no dotenv dep)
// Idempotent: GETs existing departments, POSTs only missing slugs.
// Source taxonomy: doctorbangladesh.com Sylhet hub — site titles kept verbatim.
import fs from "fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const base = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
const token = process.env.DRX_ADMIN_TOKEN || "";
if (!token) throw new Error("DRX_ADMIN_TOKEN missing in .env.local");
const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

const DEPARTMENTS = [
  { slug: "anesthesiologist", name: "Anesthesiologist", nameBn: "ব্যথা বিশেষজ্ঞ" },
  { slug: "oncologist", name: "Cancer Specialist", nameBn: "ক্যান্সার বিশেষজ্ঞ" },
  { slug: "cardiac-surgeon", name: "Cardiac Surgeon", nameBn: "কার্ডিয়াক সার্জন" },
  { slug: "cardiologist", name: "Cardiologist", nameBn: "হৃদরোগ বিশেষজ্ঞ" },
  { slug: "chest-specialist", name: "Chest Specialist", nameBn: "বক্ষব্যাধি বিশেষজ্ঞ" },
  { slug: "pediatrician", name: "Child Specialist", nameBn: "শিশু বিশেষজ্ঞ" },
  { slug: "colorectal-surgeon", name: "Colorectal Surgeon", nameBn: "কোলোরেক্টাল সার্জন" },
  { slug: "dentist", name: "Dentist", nameBn: "দাঁতের ডাক্তার" },
  { slug: "endocrinologist", name: "Endocrinologist", nameBn: "হরমোন বিশেষজ্ঞ" },
  { slug: "otolaryngologist", name: "ENT Specialist", nameBn: "নাক-কান-গলা বিশেষজ্ঞ" },
  { slug: "homeopathic", name: "Homeopathic Doctor", nameBn: "হোমিওপ্যাথি ডাক্তার" },
  { slug: "ophthalmologist", name: "Eye Specialist", nameBn: "চক্ষু বিশেষজ্ঞ" },
  { slug: "gastroenterologist", name: "Gastroenterologist", nameBn: "গ্যাস্ট্রোএন্টারোলজিস্ট" },
  { slug: "general-surgeon", name: "General Surgeon", nameBn: "জেনারেল সার্জন" },
  { slug: "gynecologist", name: "Gynecologist", nameBn: "গাইনি বিশেষজ্ঞ" },
  { slug: "hematologist", name: "Hematologist", nameBn: "রক্তরোগ বিশেষজ্ঞ" },
  { slug: "infertility-specialist", name: "Infertility Specialist", nameBn: "বন্ধ্যাত্ব বিশেষজ্ঞ" },
  { slug: "nephrologist", name: "Nephrologist", nameBn: "কিডনি বিশেষজ্ঞ" },
  { slug: "hepatologist", name: "Hepatologist", nameBn: "লিভার বিশেষজ্ঞ" },
  { slug: "medicine-specialist", name: "Medicine Specialist", nameBn: "মেডিসিন বিশেষজ্ঞ" },
  { slug: "neurologist", name: "Neurologist", nameBn: "নিউরোলজিস্ট" },
  { slug: "neurosurgeon", name: "Neurosurgeon", nameBn: "নিউরোসার্জন" },
  { slug: "orthopedic-specialist", name: "Orthopedic Surgeon", nameBn: "হাড় বিশেষজ্ঞ" },
  { slug: "pediatric-surgeon", name: "Pediatric Surgeon", nameBn: "শিশু সার্জন" },
  { slug: "physical-medicine-specialist", name: "Physical Medicine", nameBn: "ফিজিক্যাল মেডিসিন বিশেষজ্ঞ" },
  { slug: "plastic-surgeon", name: "Plastic Surgeon", nameBn: "প্লাস্টিক সার্জন" },
  { slug: "psychiatrist", name: "Psychiatrist", nameBn: "মানসিক রোগ বিশেষজ্ঞ" },
  { slug: "rheumatologist", name: "Rheumatologist", nameBn: "বাতরোগ বিশেষজ্ঞ" },
  { slug: "sexologist", name: "Sex Specialist", nameBn: "যৌনরোগ বিশেষজ্ঞ" },
  { slug: "dermatologist", name: "Dermatologist", nameBn: "চর্মরোগ বিশেষজ্ঞ" },
  { slug: "urologist", name: "Urologist", nameBn: "ইউরোলজিস্ট" },
  { slug: "vascular-surgeon", name: "Vascular Surgeon", nameBn: "ভাস্কুলার সার্জন" },
  { slug: "breast-surgeon", name: "Breast Surgeon", nameBn: "ব্রেস্ট সার্জন" },
  { slug: "cancer-surgeon", name: "Cancer Surgeon", nameBn: "ক্যান্সার সার্জন" },
  { slug: "diabetologist", name: "Diabetologist", nameBn: "ডায়াবেটিস বিশেষজ্ঞ" },
  { slug: "nutritionist", name: "Nutritionist", nameBn: "পুষ্টিবিদ" },
  { slug: "neuro-ophthalmologist", name: "Neuro-ophthalmologist", nameBn: "নিউরো-চক্ষু বিশেষজ্ঞ" },
  { slug: "gynecological-oncologist", name: "Gynecological Oncologist", nameBn: "গাইনি ক্যান্সার বিশেষজ্ঞ" },
  { slug: "pediatric-hematologist", name: "Pediatric Hematologist", nameBn: "শিশু রক্তরোগ বিশেষজ্ঞ" },
  { slug: "hepatobiliary-surgeon", name: "Hepatobiliary Surgeon", nameBn: "লিভার সার্জন" },
  { slug: "doctor-normal-delivery", name: "Normal Delivery Specialist", nameBn: "নরমাল ডেলিভারি বিশেষজ্ঞ" },
  { slug: "occupational-therapist", name: "Occupational Therapist", nameBn: "অকুপেশনাল থেরাপিস্ট" },
  { slug: "pediatric-cardiologist", name: "Pediatric Cardiologist", nameBn: "শিশু হৃদরোগ বিশেষজ্ঞ" },
  { slug: "pediatric-gastroenterologist", name: "Pediatric Gastroenterologist", nameBn: "শিশু গ্যাস্ট্রো বিশেষজ্ঞ" },
  { slug: "pediatric-neurologist", name: "Pediatric Neurologist", nameBn: "শিশু নিউরোলজিস্ট" },
  { slug: "pediatric-neurosurgeon", name: "Pediatric Neurosurgeon", nameBn: "শিশু নিউরোসার্জন" },
  { slug: "pediatric-nephrologist", name: "Pediatric Nephrologist", nameBn: "শিশু কিডনি বিশেষজ্ঞ" },
  { slug: "pediatric-ophthalmologist", name: "Pediatric Ophthalmologist", nameBn: "শিশু চক্ষু বিশেষজ্ঞ" },
  { slug: "pediatric-orthopedic-surgeon", name: "Pediatric Orthopedic", nameBn: "শিশু হাড় বিশেষজ্ঞ" },
  { slug: "pediatric-urologist", name: "Pediatric Urologist", nameBn: "শিশু ইউরোলজিস্ট" },
  { slug: "physiotherapist", name: "Physiotherapist", nameBn: "ফিজিওথেরাপিস্ট" },
  { slug: "psychologist", name: "Psychologist", nameBn: "সাইকোলজিস্ট" },
  { slug: "spine-surgeon", name: "Spine Surgeon", nameBn: "মেরুদণ্ড বিশেষজ্ঞ" },
  { slug: "best-child-psychiatrist", name: "Child & Adolescent Psychiatrist", nameBn: "শিশু-কিশোর মানসিক রোগ বিশেষজ্ঞ" },
  { slug: "female-dentist", name: "Dentist (Female)", nameBn: "মহিলা ডেন্টিস্ট" },
  { slug: "orthodontist", name: "Orthodontist", nameBn: "অর্থোডন্টিস্ট" },
  { slug: "sonologist", name: "Sonologist", nameBn: "সোনোলজিস্ট" },
];

const existing = await (await fetch(`${base}/api/v1/departments?limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
const have = new Map((existing?.data?.items ?? []).map((d) => [d.slug, d]));
let created = 0, skipped = 0, backfilled = 0;
for (const [idx, d] of DEPARTMENTS.entries()) {
  const found = have.get(d.slug);
  if (found) {
    skipped++;
    // Backfill nameBn once the backend stops dropping it (currently PATCH returns 200 but keeps null).
    if (!found.nameBn && d.nameBn) {
      const res = await fetch(`${base}/api/v1/departments/${found.id}`, {
        method: "PATCH", headers: h, body: JSON.stringify({ nameBn: d.nameBn }),
      });
      if (res.ok) {
        const check = await res.json().catch(() => null);
        if (check?.data?.nameBn) backfilled++;
      }
    }
    continue;
  }
  const res = await fetch(`${base}/api/v1/departments`, {
    method: "POST", headers: h,
    body: JSON.stringify({ ...d, tagline: `${d.name} in Sylhet`, isPublished: true, sortOrder: idx + 1 }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`POST ${d.slug} failed: ${res.status} ${t.slice(0, 200)}`);
  created++;
}
console.log(`OK: departments created=${created} skipped=${skipped} nameBn_backfilled=${backfilled} total=${DEPARTMENTS.length}`);
