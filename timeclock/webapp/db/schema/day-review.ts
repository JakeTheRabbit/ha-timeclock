import { pgTable, uuid, text, jsonb, timestamp, date, index, unique } from "drizzle-orm/pg-core";
import { employees } from "./employees";

/** A manager-approved day: staff can no longer edit that day (0013). */
export const dayApprovals = pgTable(
  "day_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    day: date("day").notNull(), // facility-local YYYY-MM-DD
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => employees.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("day_approvals_employee_id_day_key").on(t.employeeId, t.day)],
);

export type ModificationKind =
  | "entry_add"
  | "entry_edit"
  | "entry_remove"
  | "break_add"
  | "break_edit"
  | "break_remove";
export type ModificationStatus = "pending" | "acknowledged" | "disputed" | "resolved";

/** One staff self-edit, kept for a manager to acknowledge or dispute. */
export const modifications = pgTable(
  "modifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => employees.id),
    day: date("day").notNull(),
    timeEntryId: uuid("time_entry_id"),
    kind: text("kind").notNull().$type<ModificationKind>(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending").$type<ModificationStatus>(),
    acknowledgedBy: uuid("acknowledged_by").references(() => employees.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    disputedBy: uuid("disputed_by").references(() => employees.id),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => employees.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("modifications_status_idx").on(t.status, t.createdAt),
    index("modifications_emp_idx").on(t.employeeId, t.day),
  ],
);

/** Dispute conversation between a manager and the employee. */
export const modificationMessages = pgTable(
  "modification_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modificationId: uuid("modification_id")
      .notNull()
      .references(() => modifications.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => employees.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("modification_messages_mod_idx").on(t.modificationId, t.createdAt)],
);

export type DayApproval = typeof dayApprovals.$inferSelect;
export type Modification = typeof modifications.$inferSelect;
export type ModificationMessage = typeof modificationMessages.$inferSelect;
