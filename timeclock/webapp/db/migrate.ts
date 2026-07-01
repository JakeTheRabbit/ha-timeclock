import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Apply every db/migrations/*.sql in name order. Files are idempotent
 * (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS), so re-running
 * is safe. Must connect as a superuser/owner — this runs DDL. In the add-on the
 * container applies these via psql as `postgres`; this runner is for local/CI.
 */
export async function runMigrations(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required to migrate");
  const pool = new Pool({ connectionString });
  try {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      await pool.query(readFileSync(join(migrationsDir, f), "utf8"));
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${f}`);
    }
    return files;
  } finally {
    await pool.end();
  }
}
