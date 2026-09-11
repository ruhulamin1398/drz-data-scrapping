# Requirement: Symptom → Department → Doctor linkage (drx-backend)

## 1. Objective
Patients can pick a **Symptom** and reach a doctor list, reusing the existing
department → doctor flow. Today symptoms are dead-end records with no link to
anything.

Patient flow after this work:
`Symptom → Departments → Doctors` (via existing `GET /doctors?departmentId=`).

## 2. Current state (verified live against production API)
- `GET /api/v1/symptoms` → 21 records. Entity keys:
  `id, title, imageUrl, description, createdAt, updatedAt, deletedAt`.
  No `slug`, no relation to departments or doctors.
- `GET /api/v1/departments` → 57 records, keys include `id, name, nameBn, slug`.
- `GET /api/v1/doctors` → 3000+ records, each with embedded `departments[]`;
  `GET /api/v1/doctors?departmentId=<id>` already filters correctly (200).
- Proven gap: `PATCH /api/v1/symptoms/:id` with `{ "departmentIds": [...] }`
  returns `VALIDATION_ERROR: property departmentIds should not exist`.

## 3. Functional requirements

### R1. Many-to-many Symptom ↔ Department link (required)
- Add relation between Symptom and Department (join table, e.g.
  `symptom_departments`, or same pattern doctors use — follow the existing
  doctor↔department implementation for consistency).
- Accept `departmentIds: string[]` (department cuid IDs) in
  `CreateSymptomDto` and `UpdateSymptomDto`; validate each ID exists,
  reject unknown IDs with 400.
- Include `departments[]` (`id, name, nameBn, slug`) in symptom GET
  responses (`GET /symptoms`, `GET /symptoms/:id`).
- `PATCH /symptoms/:id { departmentIds }` must replace the full set.

### R2. `slug` on Symptom (required)
- Add unique `slug` field, auto-generated from `title` on create
  (lowercase, spaces/slashes → hyphens), updatable on PATCH.
- Backfill slugs for the existing 21 records via migration.
- Support `GET /api/v1/symptoms/:slug` lookup by slug as well as by id.

### R3. `GET /api/v1/symptoms/:slug/doctors` (recommended)
- Resolve symptom → its departments → doctors in those departments,
  server-side, paginated (`page/limit`, same envelope as `/doctors`).
- Dedupe doctors present in multiple departments of the same symptom.

### R4. Data cleanup (required, admin/seed)
- Delete junk record titled `Integration Fever Updated`.
- Add `Pregnancy issues` and `Piles/Anal fissure` (with slugs, images,
  descriptions) for parity with the reference product's 23 symptoms.

## 4. Acceptance criteria
1. `PATCH /api/v1/symptoms/<kidney-id> { "departmentIds": ["<nephrologist-id>", "<urologist-id>"] }` → 200, and subsequent `GET` shows both departments embedded.
2. `PATCH` with an unknown department ID → 400.
3. `GET /api/v1/symptoms/chest-pain-heart-problems` (slug) → 200 with `departments[]`.
4. (If R3) `GET /api/v1/symptoms/chest-pain-heart-problems/doctors` → 200, paginated doctors, no duplicates.
5. Existing doctor/department endpoints unchanged; all existing tests pass.

## 5. Handoff from scraping team
- After R1+R2 ship, we push the approved mapping (21 symptoms → department
  IDs) via script. Draft values (titles → department slugs, review in
  progress): `data/symptom-departments.json` in the `drz-data-scrapping` repo.
- No changes needed on the scraping pipeline or cron for this feature.

## 6. Out of scope
- Per-doctor symptom tagging (source data has no symptom tags; deliberately
  not pursued).
- Frontend symptom picker UI.
- Free-text disease search.
