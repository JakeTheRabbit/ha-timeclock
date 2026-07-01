import { pgTable, uuid, text, boolean, timestamp, index, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { employees } from "./employees";

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    jobId: uuid("job_id"), // FK to jobs added in P3
    note: text("note"),
    edited: boolean("edited").notNull().default(false),
    // Anti-fraud punch forensics (P11).
    geoLat: doublePrecision("geo_lat"),
    geoLng: doublePrecision("geo_lng"),
    punchIp: text("punch_ip"),
    photoPath: text("photo_path"),
    fraudFlags: jsonb("fraud_flags").notNull().default([]).$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("time_entries_employee_idx").on(t.employeeId, t.clockIn)],
);

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
