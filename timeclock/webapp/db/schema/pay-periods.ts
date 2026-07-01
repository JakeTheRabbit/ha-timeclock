import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { employees } from "./employees";

export const payPeriods = pgTable("pay_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull().unique(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: uuid("locked_by").references(() => employees.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayPeriod = typeof payPeriods.$inferSelect;
