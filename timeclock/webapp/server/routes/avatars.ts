import { Hono } from "hono";
import type { AppEnv } from "@/server/context";
import { getEmployeeAvatar } from "@/server/integrations/ha/avatars";

/**
 * Employee avatar proxy. GET /api/avatars/:employeeId streams the employee's
 * Home Assistant profile picture, fetched server-side via the Supervisor core
 * proxy (the SUPERVISOR_TOKEN never leaves the add-on). 404 when the employee
 * has no matching HA person picture — the client then renders initials.
 *
 * Readable by anyone who can open the panel (HA-authenticated LAN users), like
 * /auth/kiosk-employees: the kiosk staff grid needs avatars before PIN login.
 * Only non-sensitive image bytes are exposed, never the token or picture URL.
 */
export const avatars = new Hono<AppEnv>().get("/:employeeId", async (c) => {
  const employeeId = c.req.param("employeeId");
  // Cheap uuid shape guard so a bad id can't reach the DB layer.
  if (!/^[0-9a-fA-F-]{8,64}$/.test(employeeId)) {
    return c.json({ error: "bad_request" }, 400);
  }

  const img = await getEmployeeAvatar(employeeId);
  if (!img) return c.json({ error: "no_avatar" }, 404);

  return c.body(img.body, 200, {
    "content-type": img.contentType,
    // Short cache: avatars rarely change, but a person picture update should
    // show up without an add-on restart. Private (per HA-authed user session).
    "cache-control": "private, max-age=300",
  });
});
