import { getDb, getPool } from "./client";
import { employees } from "./schema";

/**
 * Idempotent first-boot seed: guarantees one active admin exists so the P2
 * admin screens are reachable on a fresh install. ha_username is claimed by
 * the first HA user to open the panel (P2 mapping flow).
 */
export async function seed() {
  const db = getDb();
  const admins = await db.query.employees.findFirst({
    where: (e, { eq, and }) => and(eq(e.role, "admin"), eq(e.active, true)),
  });
  if (!admins) {
    await db.insert(employees).values({ displayName: "Admin", role: "admin" });
  }
}

// Direct CLI use: node --experimental-strip-types db/seed.ts (local dev).
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => getPool().end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
