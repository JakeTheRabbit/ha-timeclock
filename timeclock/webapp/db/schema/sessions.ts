import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { employees } from "./employees";
import { devices } from "./devices";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    deviceId: uuid("device_id").references(() => devices.id),
    haUserId: text("ha_user_id"),
    haUserName: text("ha_user_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_employee_idx").on(t.employeeId, t.createdAt)],
);

export type Session = typeof sessions.$inferSelect;
