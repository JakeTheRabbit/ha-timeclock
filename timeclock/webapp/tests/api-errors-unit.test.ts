import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";

const err = (status: number, body: unknown) => new ApiError(status, body);

describe("apiErrorText", () => {
  it("translates known server codes", () => {
    expect(apiErrorText(err(409, { error: "already_clocked_in" }))).toBe("You're already clocked in.");
    expect(apiErrorText(err(400, { error: "overlaps_other_entry" }))).toMatch(/Overlaps another/);
  });
  it("makes unknown codes readable instead of snake_case", () => {
    expect(apiErrorText(err(400, { error: "some_new_thing" }))).toBe("Some new thing.");
  });
  it("falls back to status, then generic", () => {
    expect(apiErrorText(err(500, null))).toBe("Error 500");
    expect(apiErrorText(new TypeError("fetch failed"))).toBe("Request failed");
  });
});
