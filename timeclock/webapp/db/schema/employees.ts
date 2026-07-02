import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  haUsername: text("ha_username").unique(),
  displayName: text("display_name").notNull(),
  pinHash: text("pin_hash"),
  role: text("role").notNull().default("employee"),
  active: boolean("active").notNull().default(true),
  // Presence reminders (P15): HA notify service (e.g. notify.mobile_app_x) and
  // the presence entity that says whether they're at work.
  notifyService: text("notify_service"),
  presenceEntity: text("presence_entity"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
