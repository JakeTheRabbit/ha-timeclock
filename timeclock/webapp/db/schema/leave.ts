import { pgTable, uuid, text, date, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { employees } from "./employees";

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    type: text("type").notNull(), // annual|sick|bereavement|alt_holiday|unpaid
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id").references(() => employees.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_emp_idx").on(t.employeeId, t.createdAt),
    index("leave_requests_status_idx").on(t.status, t.createdAt),
  ],
);

export const leaveLedger = pgTable(
  "leave_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    type: text("type").notNull(), // annual|sick|bereavement|alt_holiday
    deltaHours: numeric("delta_hours", { precision: 8, scale: 2 }).notNull(),
    source: text("source").notNull(), // accrual|request|adjustment|alt_holiday_earned
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_ledger_emp_idx").on(t.employeeId, t.type)],
);

export const leaveAccrualMarks = pgTable("leave_accrual_marks", {
  employeeId: uuid("employee_id")
    .primaryKey()
    .references(() => employees.id),
  accruedThrough: timestamp("accrued_through", { withTimezone: true }).notNull(),
});

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveLedgerRow = typeof leaveLedger.$inferSelect;
