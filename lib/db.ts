import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __drzPool: Pool | undefined;
}

export function db(): Pool {
  if (!global.__drzPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL missing in .env.local");
    global.__drzPool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 5 });
  }
  return global.__drzPool;
}
