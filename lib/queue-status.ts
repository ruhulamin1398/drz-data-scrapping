import type { Pool } from "pg";

// Shared queue status semantics:
//   processing  = claimed, waiting for a worker slot (started_at IS NULL)
//   in_progress = actually running (started_at IS NOT NULL)
// Every queue table carries a nullable started_at column for this distinction.
export function queueStatusWhere(
  status: string | null,
  statusColumn: string,
  startedColumn: string,
  nextParam: number
): { clause: string; value?: string } | null {
  if (!status) return null;
  if (status === "in_progress") {
    return { clause: `${statusColumn}='processing' AND ${startedColumn} IS NOT NULL` };
  }
  if (status === "processing") {
    return { clause: `${statusColumn}='processing' AND ${startedColumn} IS NULL` };
  }
  return { clause: `${statusColumn}=$${nextParam}`, value: status };
}

export async function queueCounts(
  pool: Pool,
  table: string,
  where = "",
  values: (string | number)[] = [],
  extraStatuses: string[] = []
): Promise<Record<string, number>> {
  const out: Record<string, number> = { pending: 0, processing: 0, in_progress: 0, success: 0, failed: 0 };
  for (const s of extraStatuses) out[s] = 0;
  const r = await pool.query(
    `SELECT status, COUNT(*) c, COUNT(*) FILTER (WHERE started_at IS NOT NULL) started
     FROM ${table} ${where} GROUP BY status`,
    values
  );
  for (const row of r.rows) {
    if (row.status === "processing") {
      const started = Number(row.started);
      out.in_progress = started;
      out.processing = Number(row.c) - started;
    } else {
      out[row.status] = Number(row.c);
    }
  }
  return out;
}
