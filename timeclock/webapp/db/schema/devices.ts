import { pgTable, uuid, text, char, boolean, timestamp } from "drizzle-orm/pg-core";

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export type Device = typeof devices.$inferSelect;
