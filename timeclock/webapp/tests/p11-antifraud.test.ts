import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import { distanceMetres, geofenceFlag } from "@/server/domain/antifraud/geofence";
import { ipInCidr, ipFlag } from "@/server/domain/antifraud/ip-lock";

// Placeholder coords (Auckland CBD) — matches the geofence default in settings.
const FACILITY = { lat: -36.8485, lng: 174.7633 };

describe("P11 geofence (unit)", () => {
  it("haversine sanity: ~111km per degree of latitude", () => {
    const d = distanceMetres(FACILITY, { ...FACILITY, lat: FACILITY.lat + 1 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("flags outside radius, passes inside, flags missing coords", () => {
    const rule = { enabled: true, ...FACILITY, radiusM: 250 };
    expect(geofenceFlag(rule, FACILITY)).toBeNull();
    expect(geofenceFlag(rule, { lat: FACILITY.lat + 0.01, lng: FACILITY.lng })).toMatch(/^outside_geofence_/);
    expect(geofenceFlag(rule, null)).toBe("geo_missing");
    expect(geofenceFlag({ ...rule, enabled: false }, null)).toBeNull();
  });
});

describe("P11 IP lock (unit)", () => {
  it("CIDR membership", () => {
    expect(ipInCidr("192.168.1.55", "192.168.1.0/24")).toBe(true);
    expect(ipInCidr("192.168.74.55", "192.168.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.0.1", "10.0.0.1")).toBe(true); // exact
    expect(ipInCidr("bogus", "192.168.1.0/24")).toBe(false);
  });

  it("flag logic incl. IPv6-mapped and empty allowlist", () => {
    expect(ipFlag([], "1.2.3.4")).toBeNull(); // feature off
    expect(ipFlag(["192.168.1.0/24"], "::ffff:192.168.1.9")).toBeNull();
    expect(ipFlag(["192.168.1.0/24"], "203.0.113.7")).toMatch(/^ip_not_allowed_/);
    expect(ipFlag(["192.168.1.0/24"], null)).toBe("ip_missing");
  });
});

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P11 anti-fraud punch flow (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.PHOTOS_DIR = process.env.RUNNER_TEMP ?? process.env.TEMP ?? "/tmp";
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("flag-only mode: off-site punch is accepted but flagged + audited", async () => {
    await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({
        antifraud: { geofence: { enabled: true, enforce: false }, ipAllowlist: ["192.168.1.0/24"] },
      }),
    });

    const res = await app.request("/api/clock/in", {
      method: "POST",
      headers: { ...jsonHeaders(w.employeeCookie), "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ geo: { lat: -36.7, lng: 174.6 } }), // ~17km off-site
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fraudFlags.some((f: string) => f.startsWith("outside_geofence_"))).toBe(true);
    expect(body.fraudFlags.some((f: string) => f.startsWith("ip_not_allowed_"))).toBe(true);

    const row = await admin.query("SELECT fraud_flags, punch_ip FROM time_entries");
    expect(row.rows[0].punch_ip).toBe("203.0.113.7");
    expect(row.rows[0].fraud_flags.length).toBe(2);

    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });

  it("enforce mode: off-site punch rejected 403; on-site accepted clean", async () => {
    await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ antifraud: { geofence: { enforce: true }, ipAllowlist: [] } }),
    });

    const rejected = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ geo: { lat: -36.7, lng: 174.6 } }),
    });
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error).toBe("geofence_rejected");

    const accepted = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ geo: FACILITY }),
    });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).fraudFlags).toEqual([]);
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });

  it("photo-on-punch: required when enabled; stored and referenced", async () => {
    await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ antifraud: { geofence: { enabled: false, enforce: false }, photoOnPunch: true } }),
    });

    const noPhoto = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(noPhoto.status).toBe(400);
    expect((await noPhoto.json()).error).toBe("photo_required");

    // Tiny valid JPEG (SOI + EOI markers with filler).
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(64, 0x20),
      Buffer.from([0xff, 0xd9]),
    ]).toString("base64");

    const withPhoto = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ photo: `data:image/jpeg;base64,${jpeg}` }),
    });
    expect(withPhoto.status).toBe(201);

    const row = await admin.query(
      "SELECT photo_path FROM time_entries WHERE photo_path IS NOT NULL",
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].photo_path).toContain(".jpg");
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });

  it("audit chain intact after anti-fraud flows", async () => {
    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
