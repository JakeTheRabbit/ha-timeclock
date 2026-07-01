import { Hono } from "hono";
import { APP_TZ, nowISOInTZ } from "@/lib/tz";
import { pingDb } from "@/db/client";

// Liveness/readiness. P1 also pings Postgres so the s6 "ingress" service can
// gate on a truly-ready backend. db: "up" | "down" | "skipped" (no DATABASE_URL).
export const health = new Hono().get("/health", async (c) => {
  let db: "up" | "down" | "skipped" = "skipped";
  if (process.env.DATABASE_URL) {
    try {
      db = (await pingDb()) ? "up" : "down";
    } catch {
      db = "down";
    }
  }
  return c.json({
    status: "ok",
    phase: "P1",
    tz: APP_TZ,
    time: nowISOInTZ(),
    db,
  });
});
