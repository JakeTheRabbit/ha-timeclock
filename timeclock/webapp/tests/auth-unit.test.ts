import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, pinRateCheck, pinRateFail, pinRateReset } from "@/server/auth/pin";
import { encodeSessionCookie, decodeSessionCookie } from "@/server/auth/session";
import { roleAtLeast } from "@/server/auth/rbac";
import { newDeviceToken, hashDeviceToken } from "@/server/auth/device";

describe("PIN hashing (scrypt)", () => {
  it("round-trips and rejects wrong PIN", () => {
    const stored = hashPin("4321");
    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPin("4321", stored)).toBe(true);
    expect(verifyPin("1234", stored)).toBe(false);
  });

  it("same PIN twice -> different salts, both verify", () => {
    const a = hashPin("7777");
    const b = hashPin("7777");
    expect(a).not.toBe(b);
    expect(verifyPin("7777", a)).toBe(true);
    expect(verifyPin("7777", b)).toBe(true);
  });

  it("rejects malformed stored values", () => {
    expect(verifyPin("1234", "plaintext")).toBe(false);
    expect(verifyPin("1234", "bcrypt:aa:bb")).toBe(false);
  });
});

describe("PIN rate limiter", () => {
  it("locks after 5 failures, resets on success", () => {
    const key = "emp:devA";
    for (let i = 0; i < 5; i++) {
      expect(pinRateCheck(key).allowed).toBe(true);
      pinRateFail(key);
    }
    expect(pinRateCheck(key).allowed).toBe(false);
    expect(pinRateCheck(key).retryInMs).toBeGreaterThan(0);
    pinRateReset(key);
    expect(pinRateCheck(key).allowed).toBe(true);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 5; i++) pinRateFail("emp:devB");
    expect(pinRateCheck("emp:devB").allowed).toBe(false);
    expect(pinRateCheck("emp:devC").allowed).toBe(true);
  });
});

describe("session cookie signing", () => {
  it("round-trips a session id", () => {
    const c = encodeSessionCookie("abc-123");
    expect(decodeSessionCookie(c)).toBe("abc-123");
  });

  it("rejects tampered id and tampered signature", () => {
    const c = encodeSessionCookie("abc-123");
    const [id, sig] = [c.slice(0, c.lastIndexOf(".")), c.slice(c.lastIndexOf(".") + 1)];
    expect(decodeSessionCookie(`evil-999.${sig}`)).toBeNull();
    expect(decodeSessionCookie(`${id}.${"0".repeat(sig.length)}`)).toBeNull();
    expect(decodeSessionCookie("garbage")).toBeNull();
  });
});

describe("RBAC hierarchy", () => {
  it("orders employee < lead < manager < admin", () => {
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("manager", "manager")).toBe(true);
    expect(roleAtLeast("lead", "manager")).toBe(false);
    expect(roleAtLeast("employee", "lead")).toBe(false);
    expect(roleAtLeast("bogus", "employee")).toBe(false);
  });
});

describe("device tokens", () => {
  it("hash matches token, DB never sees raw token", () => {
    const { token, tokenHash } = newDeviceToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toBe(token);
  });
});
