import { Hono } from "hono";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { admin } from "./routes/admin";
import { clock } from "./routes/clock";
import { entries } from "./routes/entries";
import { correctionsRoute } from "./routes/corrections";
import { holidays as holidaysRoute } from "./routes/holidays";
import { roster } from "./routes/roster";
import { leave } from "./routes/leave";
import { manager } from "./routes/manager";
import { reports } from "./routes/reports";
import { ext } from "./routes/ext";
import { locale } from "./routes/locale";
import { avatars } from "./routes/avatars";
import { contextMiddleware, type AppEnv } from "./context";

// Next STRIPS its basePath before the App Router hands the request to this
// route handler — Hono sees the logical path ("/api/health"), not the physical
// "/ha-ingress/api/health" the browser used. Verified against a running
// standalone build during P0. So Hono matches on plain "/api".
export const API_BASE = "/api";

export const app = new Hono<AppEnv>().basePath(API_BASE);

app.use(contextMiddleware);

app.route("/", health);
app.route("/", locale);
app.route("/auth", auth);
app.route("/admin", admin);
app.route("/clock", clock);
app.route("/entries", entries);
app.route("/corrections", correctionsRoute);
app.route("/holidays", holidaysRoute);
app.route("/roster", roster);
app.route("/leave", leave);
app.route("/manager", manager);
app.route("/reports", reports);
app.route("/ext", ext);
app.route("/avatars", avatars);

// Fallback so unmatched API paths return JSON (not Next's HTML 404), which
// makes client error handling uniform.
app.notFound((c) =>
  c.json({ error: "not_found", path: new URL(c.req.url).pathname }, 404),
);

export type AppType = typeof app;
