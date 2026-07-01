import { describe, it, expect } from "vitest";
import {
  computeHash,
  verifyChain,
  GENESIS_HASH,
  sha256hex,
} from "@/server/domain/audit/hashchain";
import { canonicalize } from "@/server/domain/audit/canonical";

describe("hash chain (unit)", () => {
  it("computeHash = sha256(prev || payload)", () => {
    expect(computeHash(GENESIS_HASH, "abc")).toBe(sha256hex(GENESIS_HASH + "abc"));
  });

  it("verifyChain accepts a valid chain", () => {
    const p1 = "p1";
    const p2 = "p2";
    const h1 = computeHash(GENESIS_HASH, p1);
    const h2 = computeHash(h1, p2);
    const chain = [
      { prevHash: GENESIS_HASH, hash: h1, payload: p1 },
      { prevHash: h1, hash: h2, payload: p2 },
    ];
    expect(verifyChain(chain).ok).toBe(true);
  });

  it("verifyChain detects a tampered payload and reports the index", () => {
    const p1 = "p1";
    const h1 = computeHash(GENESIS_HASH, p1);
    const bad = [{ prevHash: GENESIS_HASH, hash: h1, payload: "tampered" }];
    const res = verifyChain(bad);
    expect(res.ok).toBe(false);
    expect(res.brokenIndex).toBe(0);
  });
});

describe("canonicalize (unit)", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalize({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });
});
