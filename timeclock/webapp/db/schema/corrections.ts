import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { timeEntries } from "./time-entries";
import { employees } from "./employees";

export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timeEntryId: uuid("time_entry_id")
      .notNull()
      .references(() => timeEntries.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    requested: jsonb("requested").notNull().$type<{
      clockIn?: string;
      clockOut?: string;
      note?: string;
    }>(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id").references(() => employees.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("corrections_status_idx").on(t.status, t.createdAt),
    index("corrections_employee_idx").on(t.employeeId, t.createdAt),
  ],
);

export type Correction = typeof corrections.$inferSelect;
