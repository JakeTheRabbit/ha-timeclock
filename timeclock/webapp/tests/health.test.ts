import { describe, it, expect } from "vitest";
import { app } from "@/server/hono";
import { tzOffset, APP_TZ, nowISOInTZ } from "@/lib/tz";

// P0 smoke coverage. Hono's app.request() exercises the real router (basePath,
// notFound) without booting an HTTP server. Expanded per phase.
describe("P0 API health", () => {
  it("GET /api/health returns ok + tz", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tz: string };
    expect(body.status).toBe("ok");
    expect(body.tz).toBe(APP_TZ);
  });

  it("unknown API path returns JSON 404 (not HTML)", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("P0 timezone helpers", () => {
  it("Auckland offset is +12:00 (NZST) or +13:00 (NZDT)", () => {
    expect(tzOffset()).toMatch(/^\+1[23]:00$/);
  });

  it("nowISOInTZ is a valid ISO string with offset", () => {
    expect(nowISOInTZ()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});
