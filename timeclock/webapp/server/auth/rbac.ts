import type { Context, Next } from "hono";
import type { AppEnv } from "@/server/context";

export const ROLES = ["employee", "lead", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** True when `actual` is at least as privileged as `required`. */
export function roleAtLeast(actual: string, required: Role): boolean {
  const a = ROLES.indexOf(actual as Role);
  const r = ROLES.indexOf(required);
  return a >= 0 && a >= r;
}

/** Hono guard: 401 without a session, 403 below the required role. */
export function requireRole(required: Role) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ error: "unauthenticated" }, 401);
    if (!roleAtLeast(auth.employee.role, required)) {
      return c.json({ error: "forbidden", required }, 403);
    }
    await next();
  };
}
