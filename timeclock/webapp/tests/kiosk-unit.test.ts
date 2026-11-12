import { describe, it, expect, vi, beforeEach } from "vitest";
import { orderStaff, bumpRecent } from "@/lib/kiosk-staff";

const posted: { path: string; body: Record<string, unknown> }[] = [];
let failWith: unknown = null;
vi.mock("@/lib/api-client", () => ({
  apiPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (failWith) throw failWith;
    posted.push({ path, body });
    return {};
  }),
}));

const { enqueuePunch, queuedPunches, flushQueue } = await import("@/lib/offline-queue");

describe("kiosk staff ordering", () => {
  const staff = [
    { id: "a", displayName: "Alice" },
    { id: "b", displayName: "Bob" },
    { id: "c", displayName: "Callum" },
    { id: "d", displayName: "Dana" },
  ];

  it("recent first (most recent first), rest keep server order", () => {
    expect(orderStaff(staff, ["c", "b"], "").map((e) => e.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("filters case-insensitively, still recent-first", () => {
    expect(orderStaff(staff, ["d"], " A ").map((e) => e.id)).toEqual(["d", "a", "c"]);
    expect(orderStaff(staff, [], "zzz")).toEqual([]);
  });

  it("bumpRecent dedupes and caps", () => {
    expect(bumpRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(bumpRecent(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toHaveLength(8);
  });
});

describe("offline queue is per person", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    posted.length = 0;
    failWith = null;
  });

  it("only shows and replays the signed-in person's punches, tagged queuedFor", async () => {
    enqueuePunch("emp-a", "/clock/in", { jobId: null });
    enqueuePunch("emp-b", "/clock/out", {});
    expect(queuedPunches("emp-a").map((p) => p.path)).toEqual(["/clock/in"]);

    expect(await flushQueue("emp-a")).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe("/clock/in");
    expect(posted[0].body.queuedFor).toBe("emp-a");
    expect(typeof posted[0].body.clientQueuedAt).toBe("string");

    // B's punch untouched until B signs in.
    expect(queuedPunches("emp-a")).toEqual([]);
    expect(queuedPunches("emp-b")).toHaveLength(1);
    expect(await flushQueue("emp-b")).toBe(1);
    expect(posted[1].body.queuedFor).toBe("emp-b");
    expect(queuedPunches("emp-b")).toEqual([]);
  });

  it("network failure keeps the punch; API error drops it", async () => {
    enqueuePunch("emp-a", "/clock/in", {});
    failWith = new TypeError("Failed to fetch");
    expect(await flushQueue("emp-a")).toBe(0);
    expect(queuedPunches("emp-a")).toHaveLength(1);

    failWith = new Error("409");
    expect(await flushQueue("emp-a")).toBe(0);
    expect(queuedPunches("emp-a")).toEqual([]);
  });

  it("legacy entries without an employee are never replayed", async () => {
    localStorage.setItem("tc_offline_queue", JSON.stringify([{ path: "/clock/in", data: {}, queuedAt: new Date().toISOString() }]));
    expect(await flushQueue("emp-a")).toBe(0);
    expect(posted).toEqual([]);
  });
});
