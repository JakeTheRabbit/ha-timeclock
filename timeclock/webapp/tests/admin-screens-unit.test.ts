import { describe, it, expect } from "vitest";
import { exportFormatLabel, exportFormats, type PayrollAdapter } from "@/lib/exports";
import { pinChangeProblem, validNotifyService } from "@/lib/profile";

const ADAPTERS: PayrollAdapter[] = [
  { id: "csv", label: "CSV", implemented: true },
  { id: "xero", label: "Xero", implemented: false },
  { id: "ipayroll", label: "iPayroll", implemented: false },
];

describe("exportFormats", () => {
  it("uses the configured adapter as the primary payroll export", () => {
    const withXero = ADAPTERS.map((a) => ({ ...a, implemented: true }));
    const { primary, others } = exportFormats("p1", withXero, "xero");
    expect(primary.id).toBe("xero");
    expect(primary.path).toBe("/reports/payroll?periodId=p1&adapter=xero");
    expect(others.map((o) => o.id)).toEqual(["csv", "ipayroll", "timesheet.csv", "timesheet.pdf"]);
  });

  it("falls back to CSV when the configured adapter is a stub or unknown", () => {
    expect(exportFormats("p1", ADAPTERS, "xero").primary.id).toBe("csv");
    expect(exportFormats("p1", ADAPTERS, "nope").primary.id).toBe("csv");
    expect(exportFormats("p1", ADAPTERS, undefined).primary.id).toBe("csv");
  });

  it("still offers CSV before the adapter list has loaded", () => {
    const { primary, others } = exportFormats("p1", [], undefined);
    expect(primary.path).toBe("/reports/payroll?periodId=p1&adapter=csv");
    expect(others.map((o) => o.id)).toEqual(["timesheet.csv", "timesheet.pdf"]);
  });

  it("labels audited export formats", () => {
    expect(exportFormatLabel("csv", ADAPTERS)).toBe("Payroll CSV");
    expect(exportFormatLabel("timesheet.pdf", ADAPTERS)).toBe("Timesheet PDF");
    expect(exportFormatLabel("mystery", ADAPTERS)).toBe("Payroll mystery");
    expect(exportFormatLabel(null, ADAPTERS)).toBe("export");
  });
});

describe("pinChangeProblem", () => {
  it("accepts a valid change", () => {
    expect(pinChangeProblem("1234", "5678", "5678", true)).toBeNull();
    expect(pinChangeProblem("", "123456", "123456", false)).toBeNull();
  });
  it("flags format, mismatch and unchanged PINs in that order", () => {
    expect(pinChangeProblem("1234", "12a4", "12a4", true)).toBe("format");
    expect(pinChangeProblem("1234", "123", "123", true)).toBe("format");
    expect(pinChangeProblem("1234", "1234567890123", "1234567890123", true)).toBe("format");
    expect(pinChangeProblem("1234", "5678", "5679", true)).toBe("mismatch");
    expect(pinChangeProblem("1234", "1234", "1234", true)).toBe("same");
    expect(pinChangeProblem("1234", "1234", "1234", false)).toBeNull();
  });
});

describe("validNotifyService", () => {
  it("accepts blank (clear) and notify.* ids only", () => {
    expect(validNotifyService("")).toBe(true);
    expect(validNotifyService("notify.mobile_app_pixel_8")).toBe(true);
    expect(validNotifyService("mobile_app_pixel_8")).toBe(false);
    expect(validNotifyService("notify.Mobile App")).toBe(false);
  });
});
