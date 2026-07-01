import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { nzPublicHolidays } from "@/server/domain/holidays/nz-public-holidays";

export const holidays = new Hono<AppEnv>()
  .use(requireRole("employee"))
  .get("/", (c) => {
    const year = z.coerce
      .number()
      .int()
      .min(2024)
      .max(2031)
      .catch(new Date().getFullYear())
      .parse(c.req.query("year"));
    return c.json({ year, holidays: nzPublicHolidays(year) });
  });
