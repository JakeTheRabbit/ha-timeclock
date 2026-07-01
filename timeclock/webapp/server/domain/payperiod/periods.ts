import { and, gt, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { payPeriods, type PayPeriod } from "@/db/schema";
import { getSettings } from "@/server/domain/settings";
import { nzWallToInstant } from "@/server/domain/roster/compare";

/**
 * Pay period containing an instant (convention: [start, end)), or null if no
 * period has been materialized for that window yet.
 */
export async function findPeriodContaining(at: Date): Promise<PayPeriod | null> {
  const rows = await getDb()
    .select()
    .from(payPeriods)
    .where(and(lte(payPeriods.startAt, at), gt(payPeriods.endAt, at)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Compute the period window containing `at` by tiling weekly/fortnightly
 * blocks from the anchor Monday (NZ midnight boundaries, DST-correct).
 */
export async function periodWindowContaining(at: Date): Promise<{ startAt: Date; endAt: Date }> {
  const { payPeriod } = await getSettings();
  const lengthDays = payPeriod.type === "weekly" ? 7 : 14;
  const anchor = nzWallToInstant(payPeriod.anchor, 0);

  // Tile in NZ-day steps. DST shifts make periods 13h59m/14h01m occasionally;
  // stepping by calendar days via nzWallToInstant keeps boundaries at midnight.
  let cursor = anchor;
  const dayMs = 24 * 3600_000;
  const approxPeriods = Math.floor((at.getTime() - anchor.getTime()) / (lengthDays * dayMs));
  cursor = new Date(anchor.getTime() + approxPeriods * lengthDays * dayMs);
  // Correct to exact NZ-midnight boundaries around `at`.
  const toISO = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(d);
  let startAt = nzWallToInstant(toISO(cursor), 0);
  while (startAt.getTime() > at.getTime()) {
    startAt = nzWallToInstant(toISO(new Date(startAt.getTime() - lengthDays * dayMs)), 0);
  }
  let next = nzWallToInstant(toISO(new Date(startAt.getTime() + lengthDays * dayMs + 3600_000)), 0);
  while (next.getTime() <= at.getTime()) {
    startAt = next;
    next = nzWallToInstant(toISO(new Date(startAt.getTime() + lengthDays * dayMs + 3600_000)), 0);
  }
  return { startAt, endAt: next };
}

/** Materialize (find-or-create) the pay period containing `at`. */
export async function ensurePeriodContaining(at: Date): Promise<PayPeriod> {
  const existing = await findPeriodContaining(at);
  if (existing) return existing;
  const { startAt, endAt } = await periodWindowContaining(at);
  const db = getDb();
  const [row] = await db
    .insert(payPeriods)
    .values({ startAt, endAt })
    .onConflictDoNothing({ target: payPeriods.startAt })
    .returning();
  return row ?? (await findPeriodContaining(at))!;
}
