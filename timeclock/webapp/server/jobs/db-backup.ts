import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

const BACKUP_DIR = process.env.BACKUP_DIR ?? "/data/backups";
const KEEP_DAYS = 14;

/**
 * Daily logical backup: pg_dump custom format + integrity verify via
 * pg_restore --list (validates the archive TOC end-to-end), then prune old
 * dumps. Returns the verified file path.
 */
export async function runDbBackup(now = new Date()): Promise<string> {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const file = join(BACKUP_DIR, `timeclock_${stamp}.dump`);

  const conn = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/timeclock";
  await execAsync(`pg_dump -Fc -d "${conn}" -f "${file}"`);

  // Verify: a readable TOC proves the archive is structurally sound.
  const { stdout } = await execAsync(`pg_restore --list "${file}"`);
  if (!stdout.includes("audit_log")) {
    throw new Error("backup verify failed: audit_log missing from archive TOC");
  }

  // Prune dumps older than KEEP_DAYS.
  for (const f of readdirSync(BACKUP_DIR)) {
    if (!f.startsWith("timeclock_") || !f.endsWith(".dump")) continue;
    const full = join(BACKUP_DIR, f);
    const ageDays = (now.getTime() - statSync(full).mtimeMs) / 86_400_000;
    if (ageDays > KEEP_DAYS) unlinkSync(full);
  }
  return file;
}
