import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { devices, type Device } from "@/db/schema";

export const DEVICE_COOKIE = "tc_device";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Raw token lives only in the kiosk's cookie; DB stores sha256(token). */
export function newDeviceToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function registerDevice(name: string): Promise<{ device: Device; token: string }> {
  const { token, tokenHash } = newDeviceToken();
  const [device] = await getDb().insert(devices).values({ name, tokenHash }).returning();
  return { device, token };
}

/** Device cookie -> active device row, else null. Touches last_seen_at. */
export async function loadDevice(cookieValue: string | undefined): Promise<Device | null> {
  if (!cookieValue) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, hashDeviceToken(cookieValue)))
    .limit(1);
  const device = rows[0];
  if (!device || !device.active) return null;
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));
  return device;
}

export async function countDevices(): Promise<number> {
  const rows = await getDb().select({ id: devices.id }).from(devices);
  return rows.length;
}
