import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

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
  // Door-access cross-check: this person's HA card-reader entities.
  accessEntities: text("access_entities").array().notNull().default(sql`'{}'::text[]`),
  // Pay tracking (0012): hourly rate in cents; off = no pay figures for them.
  hourlyRateCents: integer("hourly_rate_cents"),
  payTracking: boolean("pay_tracking").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
