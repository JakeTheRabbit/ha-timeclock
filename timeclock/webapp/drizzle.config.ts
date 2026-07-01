import { defineConfig } from "drizzle-kit";

// Schema lives in db/schema; SQL migrations are hand-written (db/migrations)
// because the audit triggers/grants are beyond drizzle-kit generate. Use
// `npx drizzle-kit generate` only for future plain-table diffs, then review.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/timeclock",
  },
});
