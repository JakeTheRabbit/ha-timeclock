import { describe, expect, it } from "vitest";
import {
  deepMerge,
  diffDoc,
  getPath,
  fromUnits,
  issuesAt,
  issuesFromBody,
  setPath,
  toUnits,
} from "@/lib/settings-form";
import { filterEmployees } from "@/lib/employee-list";
import { settingsIssues } from "@/server/domain/settings-schema";

const base = {
  overtime: { dailyThresholdMin: 480, multiplier1: 1.5, daily2ThresholdMin: null },
  antifraud: { ipAllowlist: ["10.0.0.0/8"], ipEnforce: false },
  integration: { apiKey: "k1" },
};

describe("diffDoc", () => {
  it("is undefined when nothing changed", () => {
    expect(diffDoc(base, structuredClone(base))).toBeUndefined();
  });
  it("returns only changed leaves", () => {
    const next = setPath(base, "overtime.multiplier1", 1.75);
    expect(diffDoc(base, next)).toEqual({ overtime: { multiplier1: 1.75 } });
  });
  it("replaces arrays whole", () => {
    const next = setPath(base, "antifraud.ipAllowlist", ["10.0.0.0/8", "192.168.1.1"]);
    expect(diffDoc(base, next)).toEqual({ antifraud: { ipAllowlist: ["10.0.0.0/8", "192.168.1.1"] } });
  });
  it("treats NaN as a change so the server can reject it", () => {
    expect(diffDoc(base, setPath(base, "overtime.daily2ThresholdMin", Number.NaN))).toEqual({
      overtime: { daily2ThresholdMin: Number.NaN },
    });
  });
  it("rebasing a dirty draft keeps a server-side key rotation", () => {
    const draft = setPath(base, "overtime.multiplier1", 2);
    const server = setPath(base, "integration.apiKey", "k2");
    const rebased = deepMerge(server, diffDoc(base, draft));
    expect(getPath(rebased, "integration.apiKey")).toBe("k2");
    expect(getPath(rebased, "overtime.multiplier1")).toBe(2);
  });
});

describe("paths + issues", () => {
  it("setPath does not mutate and creates objects", () => {
    const next = setPath(base, "rounding.mode", "up");
    expect(getPath(next, "rounding.mode")).toBe("up");
    expect((base as Record<string, unknown>).rounding).toBeUndefined();
  });
  it("issuesAt matches the field and anything below it", () => {
    const issues = [
      { path: "overtime.multiplier1", message: "a" },
      { path: "overtime.multiplier10", message: "b" },
      { path: "payPeriod.anchor", message: "c" },
    ];
    expect(issuesAt(issues, "overtime.multiplier1").map((i) => i.message)).toEqual(["a"]);
    expect(issuesAt(issues, "overtime")).toHaveLength(2);
  });
  it("issuesFromBody tolerates junk", () => {
    expect(issuesFromBody(null)).toEqual([]);
    expect(issuesFromBody({ error: "invalid_settings" })).toEqual([]);
    expect(issuesFromBody({ issues: [{ path: "a.b", message: "m" }, { nope: 1 }] })).toEqual([
      { path: "a.b", message: "m" },
    ]);
  });
  it("server schema reports dotted paths", () => {
    const issues = settingsIssues({ rounding: { incrementMin: 7 }, payPeriod: { anchor: "5 Jan" } });
    expect(issues.map((i) => i.path).sort()).toEqual(["payPeriod.anchor", "rounding.incrementMin"]);
    expect(settingsIssues({})).toEqual([]);
  });
});

describe("display units", () => {
  it("round-trips minutes shown as hours", () => {
    expect(toUnits(450, 60)).toBe("7.5");
    expect(toUnits(null, 60)).toBe("");
    expect(fromUnits("7.5", 60)).toBe(450);
    expect(fromUnits("7,5", 60)).toBe(450);
    expect(fromUnits(" ", 60)).toBeNull();
    expect(fromUnits("abc", 60)).toBeNaN();
  });
  it("keeps decimals at scale 1", () => {
    expect(fromUnits("1.75")).toBe(1.75);
    expect(toUnits(1.5)).toBe("1.5");
  });
});

describe("filterEmployees", () => {
  const list = [
    { displayName: "zoe", active: true, role: "employee", haUsername: null },
    { displayName: "Adam", active: true, role: "manager", haUsername: "adam_h" },
    { displayName: "Bea", active: false, role: "employee", haUsername: null },
  ];
  it("splits by tab and sorts by name, case-insensitive", () => {
    expect(filterEmployees(list, "active", "").map((e) => e.displayName)).toEqual(["Adam", "zoe"]);
    expect(filterEmployees(list, "inactive", "").map((e) => e.displayName)).toEqual(["Bea"]);
  });
  it("searches name, role and HA username", () => {
    expect(filterEmployees(list, "active", "ZO").map((e) => e.displayName)).toEqual(["zoe"]);
    expect(filterEmployees(list, "active", "manager").map((e) => e.displayName)).toEqual(["Adam"]);
    expect(filterEmployees(list, "active", "adam_h")).toHaveLength(1);
  });
});
