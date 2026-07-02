import { and, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees, type Employee } from "@/db/schema";
import type { HaIdentity } from "@/server/auth/provider";

/**
 * HA identity -> employee. `employees.ha_username` may hold either the opaque
 * HA user id (set by claim-admin) or the human username an admin typed in —
 * match both, username case-insensitively, so "connect my HA account" works
 * however the link was entered.
 */
export async function findEmployeeForHaIdentity(ha: HaIdentity): Promise<Employee | null> {
  const byName = ha.haUserName
    ? or(eq(employees.haUsername, ha.haUserId), ilike(employees.haUsername, ha.haUserName))
    : eq(employees.haUsername, ha.haUserId);
  const rows = await getDb()
    .select()
    .from(employees)
    .where(and(byName, eq(employees.active, true)))
    .limit(1);
  return rows[0] ?? null;
}
