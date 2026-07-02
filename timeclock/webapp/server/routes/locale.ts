import { Hono } from "hono";
import { getSettings } from "@/server/domain/settings";

/**
 * PUBLIC locale read. The full settings doc is admin-only, but every page (and
 * the kiosk, which has no session) needs the display locale to format dates,
 * times and numbers. This exposes ONLY the harmless presentation fields —
 * language, BCP-47 tag, currency code and week start — never anything sensitive.
 *
 * No auth: it is mounted on the plain (unauthenticated) app, unlike /admin.
 */
export const locale = new Hono().get("/locale", async (c) => {
  const { language, bcp47, currency, weekStart } = (await getSettings()).locale;
  return c.json({ language, bcp47, currency, weekStart });
});
