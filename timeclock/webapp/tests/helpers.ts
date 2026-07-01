import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";

export const HA_HEADERS = {
  "x-remote-user-id": "ha-user-ben",
  "x-remote-user-name": "ben",
  "x-remote-user-display-name": "Ben",
};

export function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0].split("=").slice(1).join("=");
  }
  return null;
}

/** Drop + remigrate + seed. Each integration suite starts from a clean DB. */
export async function resetDb(admin: Pool, url: string) {
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(url);
  await seed();
}

export interface AuthedWorld {
  adminCookie: string;
  employeeCookie: string;
  deviceCookie: string;
  employeeId: string;
  adminId: string;
}

type HonoApp = typeof import("@/server/hono").app;

/**
 * Standard world: claimed admin + employee "Stew" (PIN 2468) signed in on an
 * auto-bound kiosk device. Mirrors the real first-boot flow end to end.
 */
export async function bootstrapWorld(app: HonoApp): Promise<AuthedWorld> {
  const claim = await app.request("/api/auth/claim-admin", { method: "POST", headers: HA_HEADERS });
  if (claim.status !== 200) throw new Error(`claim-admin ${claim.status}`);
  const adminCookie = cookieOf(claim, "tc_session")!;
  const adminId = (await claim.json()).employee.id as string;

  const create = await app.request("/api/admin/employees", {
    method: "POST",
    headers: { cookie: `tc_session=${adminCookie}`, "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Stew", role: "employee", pin: "2468" }),
  });
  if (create.status !== 201) throw new Error(`create employee ${create.status}`);
  const employeeId = (await create.json()).employee.id as string;

  const login = await app.request("/api/auth/pin-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ employeeId, pin: "2468" }),
  });
  if (login.status !== 200) throw new Error(`pin-login ${login.status}`);
  return {
    adminCookie,
    employeeCookie: cookieOf(login, "tc_session")!,
    deviceCookie: cookieOf(login, "tc_device")!,
    employeeId,
    adminId,
  };
}

export const jsonHeaders = (cookie: string) => ({
  cookie: `tc_session=${cookie}`,
  "content-type": "application/json",
});
