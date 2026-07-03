import { describe, it, expect } from "vitest";
import { matchPicture, type PersonPicture } from "@/server/integrations/ha/avatars";
import { initials } from "@/lib/avatar";

/**
 * Avatar matching + fallback — pure logic, no DB, no HA. Exercises the
 * person -> employee match precedence documented in avatars.ts (user_id >
 * ha-username-as-name > display-name) and the initials fallback.
 */

const people: PersonPicture[] = [
  { path: "/local/demo.jpg", userId: "ha-user-demo", name: "Alex Rivera" },
  { path: "/api/image/serve/abc/512x512", userId: "ha-user-stew", name: "stew" },
  { path: "/local/priya.png", userId: null, name: "Priya Nair" },
];

describe("matchPicture", () => {
  it("matches by HA user id (SSO-linked) first", () => {
    expect(
      matchPicture({ haUsername: "ha-user-demo", displayName: "Someone Else" }, people),
    ).toBe("/local/demo.jpg");
  });

  it("matches by username stored as ha_username against the person name", () => {
    // Employee linked by the human username "stew" (not the opaque id).
    expect(
      matchPicture({ haUsername: "stew", displayName: "Stewart" }, people),
    ).toBe("/api/image/serve/abc/512x512");
  });

  it("username match is case-insensitive", () => {
    expect(
      matchPicture({ haUsername: "STEW", displayName: "x" }, people),
    ).toBe("/api/image/serve/abc/512x512");
  });

  it("falls back to display-name match when ha_username is absent", () => {
    expect(
      matchPicture({ haUsername: null, displayName: "Priya Nair" }, people),
    ).toBe("/local/priya.png");
  });

  it("display-name match is case-insensitive", () => {
    expect(
      matchPicture({ haUsername: null, displayName: "priya nair" }, people),
    ).toBe("/local/priya.png");
  });

  it("returns null when nothing matches", () => {
    expect(
      matchPicture({ haUsername: "nobody", displayName: "No One" }, people),
    ).toBeNull();
  });

  it("returns null against an empty people list", () => {
    expect(matchPicture({ haUsername: "ha-user-demo", displayName: "Alex Rivera" }, [])).toBeNull();
  });

  it("user id takes precedence over a conflicting display-name match", () => {
    // ha_username points at Ben's id, but the display name is Priya's — must
    // follow the id (the reliable SSO link), not the name.
    expect(
      matchPicture({ haUsername: "ha-user-demo", displayName: "Priya Nair" }, people),
    ).toBe("/local/demo.jpg");
  });
});

describe("initials fallback", () => {
  it("two names -> first+last initial", () => {
    expect(initials("Alex Morgan")).toBe("AM");
    expect(initials("Priya Nair")).toBe("PN");
  });
  it("single name -> first two letters", () => {
    expect(initials("Stew")).toBe("ST");
  });
  it("three names -> first+last", () => {
    expect(initials("Mary Jane Watson")).toBe("MW");
  });
  it("empty -> ?", () => {
    expect(initials("   ")).toBe("?");
  });
});
