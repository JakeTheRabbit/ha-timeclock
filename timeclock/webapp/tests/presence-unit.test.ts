import { describe, it, expect } from "vitest";
import {
  isPresent,
  evalPresence,
  initialMemory,
  type PresenceMemory,
} from "@/server/integrations/ha/presence";

// P15 presence — pure transition/decision logic. No DB, no HA.

describe("isPresent", () => {
  describe("device_tracker / person", () => {
    it("home -> present", () => {
      expect(isPresent("device_tracker.stew_phone", "home", "")).toBe(true);
      expect(isPresent("person.stew", "home", "")).toBe(true);
    });

    it("not_home -> not present", () => {
      expect(isPresent("device_tracker.stew_phone", "not_home", "")).toBe(false);
      expect(isPresent("person.stew", "not_home", "")).toBe(false);
    });

    it("a named zone (e.g. Work) is not 'home' -> not present", () => {
      // Only literal "home" counts; any other zone reads as away.
      expect(isPresent("person.stew", "Work", "")).toBe(false);
    });

    it("unavailable / unknown / empty -> null (no signal)", () => {
      expect(isPresent("device_tracker.stew_phone", "unavailable", "")).toBeNull();
      expect(isPresent("device_tracker.stew_phone", "unknown", "")).toBeNull();
      expect(isPresent("person.stew", "", "")).toBeNull();
    });
  });

  describe("binary_sensor", () => {
    it("on -> present, off -> not present", () => {
      expect(isPresent("binary_sensor.stew_connected", "on", "")).toBe(true);
      expect(isPresent("binary_sensor.stew_connected", "off", "")).toBe(false);
    });

    it("unavailable / unknown / empty -> null", () => {
      expect(isPresent("binary_sensor.stew_connected", "unavailable", "")).toBeNull();
      expect(isPresent("binary_sensor.stew_connected", "unknown", "")).toBeNull();
      expect(isPresent("binary_sensor.stew_connected", "", "")).toBeNull();
    });
  });

  describe("sensor with a configured SSID", () => {
    const SSID = "GrowFacility";

    it("state === ssid -> present", () => {
      expect(isPresent("sensor.stew_wifi_ssid", "GrowFacility", SSID)).toBe(true);
    });

    it("a different (home) SSID -> not present", () => {
      expect(isPresent("sensor.stew_wifi_ssid", "HomeNet", SSID)).toBe(false);
    });

    it("a disconnected token -> not present (never accidentally matched)", () => {
      expect(isPresent("sensor.stew_wifi_ssid", "<not connected>", SSID)).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "disconnected", SSID)).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "unavailable", SSID)).toBe(false);
    });
  });

  describe("sensor without a configured SSID", () => {
    it("any connected-looking SSID string -> present", () => {
      expect(isPresent("sensor.stew_wifi_ssid", "AnyNetwork", "")).toBe(true);
      expect(isPresent("sensor.stew_wifi_ssid", "GrowFacility", "")).toBe(true);
    });

    it("disconnected tokens -> not present (case-insensitive)", () => {
      expect(isPresent("sensor.stew_wifi_ssid", "<not connected>", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "not connected", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "disconnected", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "Disconnected", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "unavailable", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "unknown", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "none", "")).toBe(false);
      expect(isPresent("sensor.stew_wifi_ssid", "", "")).toBe(false);
    });
  });

  it("missing raw (undefined) -> null regardless of domain", () => {
    expect(isPresent("device_tracker.stew_phone", undefined, "")).toBeNull();
    expect(isPresent("binary_sensor.stew_connected", undefined, "")).toBeNull();
    expect(isPresent("sensor.stew_wifi_ssid", undefined, "GrowFacility")).toBeNull();
  });
});

describe("evalPresence", () => {
  // Standard grace config used by most cases; explicit timestamps everywhere.
  const cfg = {
    arriveGraceSec: 120,
    departGraceSec: 300,
    notifyOnArrive: true,
    notifyOnDepart: true,
  };
  const T0 = 1_000_000; // arbitrary "now" base, ms

  it("cold start adopts the current reading silently (never notifies on boot)", () => {
    // present === null means not-yet-observed.
    const arrive = evalPresence(initialMemory(), true, false, cfg, T0);
    expect(arrive.notify).toBeNull();
    expect(arrive.mem.present).toBe(true);

    const depart = evalPresence(initialMemory(), false, true, cfg, T0);
    expect(depart.notify).toBeNull();
    expect(depart.mem.present).toBe(false);
  });

  it("presentNow === null (no signal this tick) -> no change, no notify", () => {
    const prev: PresenceMemory = { present: false, candidate: null, candidateSince: 0 };
    const r = evalPresence(prev, null, false, cfg, T0);
    expect(r.notify).toBeNull();
    expect(r.mem).toBe(prev); // memory passed through untouched
  });

  it("arrive after arriveGrace while clocked-out -> notify 'in'", () => {
    const committed: PresenceMemory = { present: false, candidate: null, candidateSince: 0 };

    // First observation of the flip: within grace, pending, no notify.
    const pending = evalPresence(committed, true, false, cfg, T0);
    expect(pending.notify).toBeNull();
    expect(pending.mem.present).toBe(false); // not committed yet
    expect(pending.mem.candidate).toBe(true);
    expect(pending.mem.candidateSince).toBe(T0);

    // Grace not yet elapsed (119s) -> still pending.
    const stillPending = evalPresence(pending.mem, true, false, cfg, T0 + 119_000);
    expect(stillPending.notify).toBeNull();
    expect(stillPending.mem.present).toBe(false);

    // Grace elapsed (>=120s) -> commit and notify.
    const committedNow = evalPresence(stillPending.mem, true, false, cfg, T0 + 120_000);
    expect(committedNow.notify).toBe("in");
    expect(committedNow.mem.present).toBe(true);
    expect(committedNow.mem.candidate).toBeNull();
  });

  it("arrive after grace but ALREADY clocked-in -> commit state, no notify", () => {
    const committed: PresenceMemory = { present: false, candidate: null, candidateSince: 0 };
    const pending = evalPresence(committed, true, true, cfg, T0);
    const done = evalPresence(pending.mem, true, true, cfg, T0 + 120_000);
    expect(done.notify).toBeNull();
    expect(done.mem.present).toBe(true); // still commits the presence flip
  });

  it("depart after departGrace while clocked-in -> notify 'out'", () => {
    const committed: PresenceMemory = { present: true, candidate: null, candidateSince: 0 };

    const pending = evalPresence(committed, false, true, cfg, T0);
    expect(pending.notify).toBeNull();
    expect(pending.mem.present).toBe(true);
    expect(pending.mem.candidate).toBe(false);
    expect(pending.mem.candidateSince).toBe(T0);

    // departGrace is 300s: 299s not enough.
    const stillPending = evalPresence(pending.mem, false, true, cfg, T0 + 299_000);
    expect(stillPending.notify).toBeNull();
    expect(stillPending.mem.present).toBe(true);

    // 300s elapsed -> commit + notify 'out'.
    const done = evalPresence(stillPending.mem, false, true, cfg, T0 + 300_000);
    expect(done.notify).toBe("out");
    expect(done.mem.present).toBe(false);
    expect(done.mem.candidate).toBeNull();
  });

  it("depart after grace but NOT clocked-in -> commit, no notify", () => {
    const committed: PresenceMemory = { present: true, candidate: null, candidateSince: 0 };
    const pending = evalPresence(committed, false, false, cfg, T0);
    const done = evalPresence(pending.mem, false, false, cfg, T0 + 300_000);
    expect(done.notify).toBeNull();
    expect(done.mem.present).toBe(false);
  });

  it("flap back to committed state before grace cancels the pending flip", () => {
    const committed: PresenceMemory = { present: false, candidate: null, candidateSince: 0 };

    // Starts arriving...
    const pending = evalPresence(committed, true, false, cfg, T0);
    expect(pending.mem.candidate).toBe(true);

    // ...then flaps back to away before grace elapses -> candidate cleared.
    const cancelled = evalPresence(pending.mem, false, false, cfg, T0 + 60_000);
    expect(cancelled.notify).toBeNull();
    expect(cancelled.mem.present).toBe(false); // still committed-away
    expect(cancelled.mem.candidate).toBeNull();
    expect(cancelled.mem.candidateSince).toBe(0);

    // A later steady arrival must serve the FULL grace again (timer reset):
    // 60s after the flap-back is not enough even though total elapsed is 120s.
    const reArm = evalPresence(cancelled.mem, true, false, cfg, T0 + 120_000);
    expect(reArm.notify).toBeNull();
    expect(reArm.mem.candidate).toBe(true);
    expect(reArm.mem.candidateSince).toBe(T0 + 120_000);

    const finally_ = evalPresence(reArm.mem, true, false, cfg, T0 + 240_000);
    expect(finally_.notify).toBe("in");
  });

  it("only one notify per committed transition (steady-state ticks are silent)", () => {
    const committed: PresenceMemory = { present: false, candidate: null, candidateSince: 0 };
    const pending = evalPresence(committed, true, false, cfg, T0);
    const commitTick = evalPresence(pending.mem, true, false, cfg, T0 + 120_000);
    expect(commitTick.notify).toBe("in");

    // Subsequent identical readings: state already committed -> no repeat notify.
    const tick2 = evalPresence(commitTick.mem, true, false, cfg, T0 + 180_000);
    expect(tick2.notify).toBeNull();
    const tick3 = evalPresence(tick2.mem, true, false, cfg, T0 + 240_000);
    expect(tick3.notify).toBeNull();
  });

  it("respects notifyOnArrive=false / notifyOnDepart=false toggles", () => {
    const noArrive = { ...cfg, notifyOnArrive: false };
    const p1 = evalPresence(
      { present: false, candidate: null, candidateSince: 0 },
      true,
      false,
      noArrive,
      T0,
    );
    const c1 = evalPresence(p1.mem, true, false, noArrive, T0 + 120_000);
    expect(c1.notify).toBeNull();
    expect(c1.mem.present).toBe(true); // still commits, just no notification

    const noDepart = { ...cfg, notifyOnDepart: false };
    const p2 = evalPresence(
      { present: true, candidate: null, candidateSince: 0 },
      false,
      true,
      noDepart,
      T0,
    );
    const c2 = evalPresence(p2.mem, false, true, noDepart, T0 + 300_000);
    expect(c2.notify).toBeNull();
    expect(c2.mem.present).toBe(false);
  });

  it("zero grace commits immediately on first differing observation", () => {
    const instant = { ...cfg, arriveGraceSec: 0 };
    const r = evalPresence(
      { present: false, candidate: null, candidateSince: 0 },
      true,
      false,
      instant,
      T0,
    );
    expect(r.notify).toBe("in");
    expect(r.mem.present).toBe(true);
  });
});
