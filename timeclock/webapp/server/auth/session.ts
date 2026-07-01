import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, employees, type Employee, type Session } from "@/db/schema";

export const SESSION_COOKIE = "tc_session";
export const SESSION_TTL_HOURS = 14; // covers a long shift; kiosk re-PINs daily

// HMAC secret: injected by the add-on run script (generated once into /data).
// Dev/test fallback is per-process random — sessions die with the process.
let secret: Buffer | undefined;
function getSecret(): Buffer {
  if (!secret) {
    secret = process.env.SESSION_SECRET
      ? Buffer.from(process.env.SESSION_SECRET, "hex")
      : randomBytes(32);
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

/** Cookie payload is "sessionId.hmac" — tamper-evident, DB holds the state. */
export function encodeSessionCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function decodeSessionCookie(cookie: string): string | null {
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export interface SessionInfo {
  session: Session;
  employee: Employee;
}

export async function createSession(input: {
  employeeId: string;
  deviceId?: string | null;
  haUserId?: string | null;
  haUserName?: string | null;
}): Promise<Session> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
  const [row] = await db
    .insert(sessions)
    .values({
      employeeId: input.employeeId,
      deviceId: input.deviceId ?? null,
      haUserId: input.haUserId ?? null,
      haUserName: input.haUserName ?? null,
      expiresAt,
    })
    .returning();
  return row;
}

/** Cookie -> live (unexpired, unrevoked) session + employee, else null. */
export async function loadSession(cookieValue: string | undefined): Promise<SessionInfo | null> {
  if (!cookieValue) return null;
  const id = decodeSessionCookie(cookieValue);
  if (!id) return null;
  const db = getDb();
  const rows = await db
    .select({ session: sessions, employee: employees })
    .from(sessions)
    .innerJoin(employees, eq(sessions.employeeId, employees.id))
    .where(
      and(
        eq(sessions.id, id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(employees.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}
