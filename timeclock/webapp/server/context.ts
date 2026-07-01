import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { authProvider, type HaIdentity } from "@/server/auth/provider";
import { loadSession, SESSION_COOKIE, type SessionInfo } from "@/server/auth/session";

/** Per-request context variables available on every Hono handler. */
export type AppEnv = {
  Variables: {
    /** Employee session (kiosk PIN login), if any. */
    auth: SessionInfo | null;
    /** HA user who opened the panel (Ingress headers), if any. */
    haIdentity: HaIdentity | null;
  };
};

/** Resolves HA identity + employee session once per request. */
export const contextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("haIdentity", authProvider.resolveIdentity(c.req.raw.headers));
  c.set("auth", await loadSession(getCookie(c, SESSION_COOKIE)));
  await next();
};
