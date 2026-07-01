import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  haUsername: text("ha_username").unique(),
  displayName: text("display_name").notNull(),
  pinHash: text("pin_hash"),
  role: text("role").notNull().default("employee"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
