import { pgTable, uuid, text, date, integer, timestamp, index } from "drizzle-orm/pg-core";
import { employees } from "./employees";

// Never deleted — a wrong bonus is voided. App role has no DELETE (0012).
export const bonuses = pgTable(
  "bonuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    awardedOn: date("awarded_on").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: uuid("paid_by").references(() => employees.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => employees.id),
    voidReason: text("void_reason"),
  },
  (t) => [index("bonuses_emp_idx").on(t.employeeId, t.awardedOn)],
);

export type Bonus = typeof bonuses.$inferSelect;
