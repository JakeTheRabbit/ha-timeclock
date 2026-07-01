import { pgTable, uuid, date, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { employees } from "./employees";
import { jobs } from "./jobs";

export const rosters = pgTable(
  "rosters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    shiftDate: date("shift_date").notNull(), // YYYY-MM-DD (NZ calendar)
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    note: text("note"),
    cancelled: boolean("cancelled").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rosters_date_idx").on(t.shiftDate, t.employeeId),
    index("rosters_employee_idx").on(t.employeeId, t.shiftDate),
  ],
);

export type Roster = typeof rosters.$inferSelect;
