# Facilities

## Purpose
Facilities are clinics/hospitals/diagnostics — the anchor entity for chambers and transactions.

## Rules
- Integer `id`. Reads public; writes ADMIN/SUPER_ADMIN. Soft delete + restore.
- Required on create: `name`, `divisionId`, `districtId`, `typeId` (int ids).
- Booking app fields: `hasBookingApp: bool`, `bookingAppLink: string`, `bookingAppName: string`.
- `socialLinks: [{platform,url}]` inline on create/update.
  - create → links created with facility.
  - update → if `socialLinks` present it REPLACES all existing links; omitted = untouched.
  - fetch (`GET /facilities`, `GET /facilities/:id`) populates `socialLinks[]` only when included in `?fields=` (default response is `id` only).
- Filters: `search, divisionId, districtId, upazilaId, paursavaId, cityCorporationId,
  unionId, typeId, isPrivate` + pagination/`includeDeleted` — any location level with `all` (e.g. `?districtId=all`, `?division=Sylhet&district=all`, `?district=Habiganj&upazila=all`) means no filter at that level (case-insensitive, supports `divisionId` numeric and `division` slug/name string for all levels).
- Field selector (GraphQL-like, fully field-driven): `?fields=id,name,slug` or repeated `?fields=id&fields=name` on `GET /facilities`, `/facilities/search`, `/facilities/:id`. Omitted/empty/invalid-only => `id` only. Unknown names ignored, deduped, order preserved. Relations allowed: `division, district, upazila, paursava, cityCorporation, union, type, socialLinks`.
- Bulk delete max 500 ids; idempotent (already-deleted land in `notFound`).
- Bulk update `PATCH /facilities/bulk` `{ids:[…], data:{…}}` (max 500): same partial fields as single update applied to every matched id; `data` must be non-empty; `socialLinks`, if present, replaces links per facility. Returns `{updated, notFound, count}`.








## Schema

### Facility Schema

| # | Field Name | Type | Comment |
| --- | ---------- | ---- | ------- |
| 1 | id | Int (PK) (Default: autoincrement()) | Primary identifier (PK) Default: autoincrement() |
| 2 | name | String | Display name |
| 3 | nameBn | String (Default: "") | Bengali name Default: "" |
| 4 | slug | String (Unique) | URL-friendly slug (Unique) |
| 5 | registrationId | Int (Optional) | Registration ID (Optional) |
| 6 | code | String (Default: "") | Facility code Default: "" |
| 7 | email | String (Default: "") | Email address Default: "" |
| 8 | isPrivate | Boolean (Default: false) | Private facility flag Default: false |
| 9 | fullAddress | String (Default: "") | Full street address Default: "" |
| 10 | phones | String[] (Default: []) | Contact numbers Default: [] |
| 11 | website | String (Default: "") | Website URL Default: "" |
| 12 | officialWebsite | String (Default: "") | Official website URL Default: "" |
| 13 | category | String (Default: "") | Category Default: "" |
| 14 | extraInformation | String (Optional) | Additional unstructured information (Optional) |
| 15 | hasBookingApp | Boolean (Default: false) | Whether booking app is available Default: false |
| 16 | bookingAppLink | String (Default: "") | Booking app link Default: "" |
| 17 | bookingAppName | String (Default: "") | Booking app name Default: "" |
| 18 | isPublished | Boolean (Default: false) | Publish status Default: false |
| 19 | websiteAttemptCount | Int (Default: 0) | Website scrape attempt count Default: 0 |
| 20 | doctorScrapeAttemptCount | Int (Default: 0) | Doctor scrape attempt count Default: 0 |
| 21 | searchGroundingStage | Int (Default: 0) | Search grounding stage for scraping Default: 0 |
| 22 | isProcessing | Boolean (Default: false) | Processing lock flag Default: false |
| 23 | lastWebsiteAttemptAt | DateTime (Optional) | Last website attempt timestamp (Optional) |
| 24 | lastDoctorScrapeAttemptAt | DateTime (Optional) | Last doctor scrape attempt timestamp (Optional) |
| 25 | divisionId | Int | Division ID |
| 26 | division | Division | Division relation |
| 27 | districtId | Int | District ID |
| 28 | district | District | District relation |
| 29 | upazilaId | Int (Optional) | Upazila ID (Optional) |
| 30 | upazila | Upazila (Optional) | Upazila relation (Optional) |
| 31 | paursavaId | Int (Optional) | PauraSava ID (Optional) |
| 32 | paursava | Paurasava (Optional) | PauraSava relation (Optional) |
| 33 | cityCorporationId | Int (Optional) | City corporation ID (Optional) |
| 34 | cityCorporation | CityCorporation (Optional) | City corporation relation (Optional) |
| 35 | unionId | Int (Optional) | Union ID (Optional) |
| 36 | union | Union (Optional) | Union relation (Optional) |
| 37 | typeId | Int | Facility type ID |
| 38 | type | FacilityType | Facility type relation |
| 39 | chambers | Chamber[] | chambers |
| 40 | socialLinks | SocialLink[] | Social links (JSON) |
| 41 | createdAt | DateTime (Default: now()) | Creation timestamp Default: now() |
| 42 | updatedAt | DateTime | Last update timestamp |
| 43 | deletedAt | DateTime (Optional) | Soft delete timestamp (Optional) |

> Full schema: [`schema-facility.md`](schema-facility.md)

## Endpoints

| Method | Path | Auth | Purpose | Parameters | Response |
| ------ | ---- | ---- | ------- | ---------- | -------- |
| GET | /facilities | Public | paginated list w/ filters, id-only by default | `search`, `divisionId`, `districtId`, `upazilaId`, `paursavaId`, `cityCorporationId`, `unionId`, `typeId`, `isPrivate`, `page`, `limit`, `order`, `includeDeleted` (admin), `fields?` (default `id` only) | `200 {"success":true,"data":{"items":[{"id":18186}],"meta":{"page":1,"limit":20,"totalItems":15544,"totalPages":778,"hasPreviousPage":false,"hasNextPage":true}},"timestamp":"…"}` |
| GET | /facilities/search | Public | alias of list | same as list | same as list |
| GET | /facilities/stats | Public | totals + privateCount + per-type counts | — | `200 {"success":true,"data":{"total":15544,"privateCount":9120,"byType":[{"typeId":14,"_count":{"_all":2103}}]},"timestamp":"…"}` |
| GET | /facilities/types | Public | types with facility counts | — | `200 {"success":true,"data":[{"id":14,"name":"Hospital","slug":"hospital"}],"timestamp":"…"}` |
| GET | /facilities/:id | Public | one facility, id-only by default (`?fields=` to expand) | `id` (int, path), `fields?` (default `id` only) | `200 {"success":true,"data":{"id":18186,"name":"Lab One Diagnostic Centre","fullAddress":"Mymensingh Sadar, Bangladesh","phones":["01711-137979"]},"timestamp":"…"}` · `404 FACILITY_NOT_FOUND` |
| POST | /facilities | ADMIN/SUPER_ADMIN | create (socialLinks optional) | `name`, `divisionId`, `districtId`, `typeId`, `fullAddress?`, `phones?` (string[]), `email?`, `website?`, `isPrivate?`, `hasBookingApp?`, `bookingAppLink?`, `bookingAppName?`, `extraInformation?`, `socialLinks?` | `201 {"success":true,"data":{"id":15545,"name":"Square Hospital","fullAddress":"18/F Bir Uttam Road, Dhaka","phones":["+8801700000000"],"divisionId":41,"districtId":257,"typeId":14,"socialLinks":[]},"timestamp":"…"}` |
| PATCH | /facilities/:id | ADMIN/SUPER_ADMIN | partial update (socialLinks replace-if-present) | `id` (int, path), all create fields optional, `socialLinks?` replaces all | `200` full facility object (same shape as create) · `404 FACILITY_NOT_FOUND` |
| PATCH | /facilities/bulk | ADMIN/SUPER_ADMIN | bulk update `{ids, data}` ≤500 | `ids: int[]` + partial `data` (non-empty) → dummy below | `200 {"success":true,"data":{"updated":[1112,4645],"notFound":[],"count":2},"timestamp":"…"}` · `400 FACILITY_BULK_UPDATE_EMPTY_DATA` when `data` empty |
| DELETE | /facilities/:id | ADMIN/SUPER_ADMIN | soft delete | `id` (int, path) | `204` (no content) · `404 FACILITY_NOT_FOUND` |
| DELETE | /facilities/bulk | ADMIN/SUPER_ADMIN | bulk soft delete `{ids:[…]}` ≤500 | `ids: int[]` (body) | `200 {"success":true,"data":{"deleted":[1112,4645],"notFound":[],"count":2},"timestamp":"…"}` |
| PATCH | /facilities/:id/restore | ADMIN/SUPER_ADMIN | restore | `id` (int, path) | `200 {"success":true,"data":{"id":1,"deletedAt":null},"timestamp":"…"}` · `404 FACILITY_NOT_FOUND` |

### Create body
```json
{
  "name": "Square Hospital",
  "divisionId": 41, "districtId": 257, "typeId": 14,
  "fullAddress": "18/F Bir Uttam Road, Dhaka", "phones": ["+8801700000000", "+8801800000000"],
  "email": "info@square.example", "website": "https://square.example",
  "isPrivate": true, "hasBookingApp": true, "bookingAppLink": "https://book.example",
  "bookingAppName": "Square Booking",
  "extraInformation": "any long text",
  "socialLinks": [{ "platform": "facebook", "url": "https://facebook.com/square" }]
}
```
Response 201: full facility incl. relations + `socialLinks[]`.
Errors: 400 validation · 401/403 auth · 404 FACILITY_NOT_FOUND on :id routes.

## Example
```bash
curl -s "https://api-9028.doctorzonebd.com/api/v1/facilities/20011?fields=id,name,socialLinks" | jq '.data.socialLinks'
```