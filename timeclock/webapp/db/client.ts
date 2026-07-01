import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

/** Lightweight readiness ping used by the health route. */
export async function pingDb(): Promise<boolean> {
  const res = await getPool().query("SELECT 1 AS ok");
  return res.rows[0]?.ok === 1;
}

/** Chain integrity check via the DB verifier (compliance viewer, P8). */
export async function verifyAuditChain() {
  const rows = await getDb().execute(
    sql`SELECT ok, broken_at, detail FROM verify_audit_chain()`,
  );
  return rows.rows[0] as { ok: boolean; broken_at: number | null; detail: string };
}
