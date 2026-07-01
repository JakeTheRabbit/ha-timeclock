import { pgTable, uuid, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { timeEntries } from "./time-entries";

export const breaks = pgTable(
  "breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timeEntryId: uuid("time_entry_id")
      .notNull()
      .references(() => timeEntries.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    paid: boolean("paid").notNull().default(false),
    autoDeducted: boolean("auto_deducted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("breaks_entry_idx").on(t.timeEntryId)],
);

export type Break = typeof breaks.$inferSelect;
