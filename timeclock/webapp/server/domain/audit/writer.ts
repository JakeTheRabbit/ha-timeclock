import { getDb } from "@/db/client";
import { auditLog, type AuditRow } from "@/db/schema";
import { canonicalize } from "./canonical";

export interface AuditInput {
  entityType: string; // 'time_entry' | 'employee' | ...
  entityId: string;
  action: string; // 'create' | 'update' | 'clock_in' | 'clock_out' | ...
  actorId?: string | null; // who performed it
  reason?: string | null; // MANDATORY for edits (enforced by the caller)
  oldValue?: unknown; // prior state (edits)
  newValue?: unknown; // new state
}

type Db = ReturnType<typeof getDb>;

/**
 * The ONLY write path into audit_log — INSERT only (Layer 1). prev_hash/hash are
 * filled by the DB trigger (Layer 3); UPDATE/DELETE are impossible (Layer 2).
 * Accepts a transaction handle so an edit + its audit row commit atomically.
 */
export async function appendAudit(input: AuditInput, db: Db = getDb()): Promise<AuditRow> {
  const oldValue = input.oldValue === undefined ? null : canonicalize(input.oldValue);
  const newValue = input.newValue === undefined ? null : canonicalize(input.newValue);

  // The canonical payload the hash is bound to. Independent of display columns.
  const payload = canonicalize({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
    old: input.oldValue ?? null,
    new: input.newValue ?? null,
  });

  const [row] = await db
    .insert(auditLog)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
      oldValue,
      newValue,
      payload,
    })
    .returning();

  return row;
}
