import { pgTable, bigserial, uuid, text, char, timestamp, index } from "drizzle-orm/pg-core";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    actorId: uuid("actor_id"),
    reason: text("reason"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    payload: text("payload").notNull(),
    // prev_hash/hash are populated by the BEFORE INSERT trigger (0001), never by
    // the app. The empty default here is a TS-only hint so inserts may omit them;
    // the real values come from the DB. Schema is not used to generate SQL.
    prevHash: char("prev_hash", { length: 64 }).notNull().default(""),
    hash: char("hash", { length: 64 }).notNull().unique().default(""),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId, t.id)],
);

export type AuditRow = typeof auditLog.$inferSelect;
