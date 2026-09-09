// Batch doctor processing (Sylhet pilot): node scripts/process-doctors-batch.mjs [max] [workers]
// Drives the deployed step endpoints (fetch -> extract -> drx -> queue PATCH) from
// local machine — no serverless timeout, browser need not stay open.
// Stops early on Jina quota/rate-limit errors; per-item failures are marked failed.
const PROD = process.env.PROD_BASE || "https://drz-data-scrapping.vercel.app";
const MAX = Number(process.argv[2] ?? 25);
const WORKERS = Number(process.argv[3] ?? 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopped = "";
let ok = 0, fail = 0;

async function patch(url, body) {
  await fetch(`${PROD}/api/doctors/queue`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...body }),
  });
}

function quotaHit(msg) {
  return /402|429|rate.?limit|quota|insufficient|balance|payment/i.test(msg || "");
}

async function processOne(q) {
  try {
    await patch(q.source_url, { status: "processing", failReason: null });
    const f = await fetch(`${PROD}/api/doctors/fetch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: q.source_url }),
    });
    const fj = await f.json();
    if (!f.ok) throw new Error(fj.error || `fetch ${f.status}`);

    const e = await fetch(`${PROD}/api/doctors/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: fj.markdown, specialty: q.specialty_slug, card: q.card_text }),
    });
    const ej = await e.json();
    if (!e.ok) throw new Error(ej.error || `extract ${e.status}`);

    const d = await fetch(`${PROD}/api/doctors/drx`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doctor: ej.doctor, departmentIds: q.department_ids,
        sourceUrl: q.source_url, drxId: q.drx_id ?? undefined,
      }),
    });
    const dj = await d.json();
    if (!d.ok) throw new Error(dj.error || `drx ${d.status}`);

    await patch(q.source_url, { status: "success", name: ej.doctor.name, drxId: dj.drxId, failReason: null });
    ok++;
    console.log(`ok ${ok + fail}/${MAX} :: ${ej.doctor.name} -> ${dj.drxId} (${dj.degrees} deg)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (quotaHit(msg)) { stopped = msg.slice(0, 120); }
    await patch(q.source_url, { status: "failed", failReason: msg.slice(0, 300) });
    fail++;
    console.log(`FAIL ${ok + fail}/${MAX} :: ${q.source_url} :: ${msg.slice(0, 120)}`);
  }
}

const r = await fetch(`${PROD}/api/doctors/queue?status=pending&limit=${MAX}`);
const j = await r.json();
const rows = (j.items ?? []).slice(0, MAX);
console.log(`claimed scope: ${rows.length} pending (max ${MAX}), ${WORKERS} workers`);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, rows.length) }, async () => {
  while (!stopped) {
    const i = cursor++;
    if (i >= rows.length) return;
    await processOne(rows[i]);
    await sleep(1000);
  }
}));
console.log(`DONE: ok=${ok} failed=${fail}${stopped ? ` STOPPED: ${stopped}` : ""}`);
