/**
 * In-browser demo backend.
 *
 * When NEXT_PUBLIC_DEMO === "1", lib/api-client.ts routes every `/api/*` call
 * here instead of `fetch`, so the whole app runs with no Hono/Postgres — for the
 * GitHub Pages demo. State lives in module memory: clock in/out, breaks, edits,
 * corrections, approvals, roster and leave all mutate visibly within a session
 * (a page reload reseeds).
 *
 * This module is behind a `process.env.NEXT_PUBLIC_DEMO === "1"` dynamic import
 * in api-client, so webpack tree-shakes it out of the production standalone
 * build entirely.
 *
 * Response shapes mirror the real Hono routes exactly (see server/routes/*).
 */

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

interface DemoEmployee {
  id: string;
  displayName: string;
  role: "employee" | "lead" | "manager" | "admin";
  active: boolean;
  haUsername: string | null;
  pin: string | null;
  notifyService: string | null;
  presenceEntity: string | null;
}

interface DemoBreak {
  id: string;
  timeEntryId: string;
  startAt: string;
  endAt: string | null;
  paid: boolean;
  autoDeducted: boolean;
}

interface DemoEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  jobId: string | null;
  edited: boolean;
  note: string | null;
}

interface DemoCorrection {
  id: string;
  employeeId: string;
  employeeName: string;
  entryId: string;
  reason: string;
  requested: { clockIn?: string; clockOut?: string; note?: string };
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface DemoLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
}

interface DemoShift {
  id: string;
  employeeId: string;
  shiftDate: string;
  startMin: number;
  endMin: number;
  note: string | null;
}

interface DemoAudit {
  id: number;
  createdAt: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  hash: string;
}

interface DemoState {
  employees: DemoEmployee[];
  entries: DemoEntry[];
  breaks: DemoBreak[];
  jobs: { id: string; name: string; code: string | null; active: boolean }[];
  corrections: DemoCorrection[];
  leave: DemoLeave[];
  shifts: DemoShift[];
  audit: DemoAudit[];
  sessionEmployeeId: string; // who is "signed in" (demo auto-signs-in the admin)
  settings: Json;
  auditSeq: number;
}

let state: DemoState;

const iso = (d: Date) => d.toISOString();
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
/** A date `n` days ago at a given local-ish hour/min (UTC for determinism). */
function at(nDaysAgo: number, hour: number, min = 0): Date {
  const d = daysAgo(nDaysAgo);
  d.setUTCHours(hour, min, 0, 0);
  return d;
}

let idc = 1;
const nid = (p: string) => `${p}-${(idc++).toString(36)}-demo`;
// Deterministic-ish uuid-shaped id (some client schemas expect uuid).
function uuid(seed: number): string {
  const h = (n: number, len: number) => (n * 2654435761 >>> 0).toString(16).padStart(8, "0").slice(0, len);
  return `${h(seed, 8)}-${h(seed + 1, 4)}-4${h(seed + 2, 3)}-8${h(seed + 3, 3)}-${h(seed + 4, 12).padEnd(12, "0")}`;
}

function pushAudit(a: Omit<DemoAudit, "id" | "createdAt" | "hash">) {
  const id = state.auditSeq++;
  state.audit.unshift({
    ...a,
    id,
    createdAt: iso(new Date()),
    hash: uuid(id + 9000).replace(/-/g, "").slice(0, 40),
  });
}

function seed(): DemoState {
  idc = 1;
  const emp = (
    seedN: number,
    displayName: string,
    role: DemoEmployee["role"],
    pin: string | null,
  ): DemoEmployee => ({
    id: uuid(seedN),
    displayName,
    role,
    active: true,
    haUsername: role === "admin" ? "demo_admin" : displayName.toLowerCase().split(" ")[0],
    pin,
    notifyService: null,
    presenceEntity: null,
  });

  const employees: DemoEmployee[] = [
    emp(1, "Alex Morgan", "admin", "1234"),
    emp(6, "Priya Nair", "manager", "2345"),
    emp(11, "Sam Rivera", "lead", "3456"),
    emp(16, "Jordan Lee", "employee", "4567"),
    emp(21, "Casey Brooks", "employee", "5678"),
    emp(26, "Taylor Quinn", "employee", null),
  ];

  const jobs = [
    { id: uuid(100), name: "Front of house", code: "FOH", active: true },
    { id: uuid(104), name: "Kitchen", code: "KIT", active: true },
    { id: uuid(108), name: "Deliveries", code: "DEL", active: true },
  ];

  const entries: DemoEntry[] = [];
  const breaks: DemoBreak[] = [];
  // Build ~5 weeks of shifts for the non-admin staff, weekdays.
  const workers = employees.filter((e) => e.role !== "admin");
  let eSeed = 200;
  for (let d = 34; d >= 1; d--) {
    const date = daysAgo(d);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    for (const w of workers) {
      // Skip some days per person for realism.
      if ((d + w.displayName.length) % 4 === 0) continue;
      const startH = 8 + ((d + w.displayName.length) % 2); // 8 or 9
      const clockIn = at(d, startH, (d * 7) % 60);
      const shiftLen = 7 + ((d + w.displayName.charCodeAt(0)) % 3); // 7–9h
      const clockOut = new Date(clockIn.getTime() + shiftLen * 3600_000);
      const entryId = uuid(eSeed++);
      const edited = d === 12 && w.displayName === "Jordan Lee";
      entries.push({
        id: entryId,
        employeeId: w.id,
        clockIn: iso(clockIn),
        clockOut: iso(clockOut),
        jobId: jobs[(d + w.displayName.length) % jobs.length].id,
        edited,
        note: edited ? "Corrected clock-out (forgot to punch)" : null,
      });
      // A lunch break most days.
      if ((d + w.displayName.length) % 3 !== 0) {
        const bStart = new Date(clockIn.getTime() + 4 * 3600_000);
        breaks.push({
          id: uuid(eSeed++),
          timeEntryId: entryId,
          startAt: iso(bStart),
          endAt: iso(new Date(bStart.getTime() + 30 * 60_000)),
          paid: false,
          autoDeducted: false,
        });
      }
    }
  }

  // Two people currently ON the clock (today), so the live board isn't empty.
  const onNow = [workers[0], workers[1]];
  for (let i = 0; i < onNow.length; i++) {
    const w = onNow[i];
    const clockIn = at(0, 8 + i, 5);
    // Ensure it's in the past today.
    if (clockIn.getTime() > Date.now()) clockIn.setTime(Date.now() - (2 + i) * 3600_000);
    const entryId = uuid(eSeed++);
    entries.push({
      id: entryId,
      employeeId: w.id,
      clockIn: iso(clockIn),
      clockOut: null,
      jobId: jobs[i % jobs.length].id,
      edited: false,
      note: null,
    });
    // Second person is on a break right now.
    if (i === 1) {
      breaks.push({
        id: uuid(eSeed++),
        timeEntryId: entryId,
        startAt: iso(new Date(Date.now() - 15 * 60_000)),
        endAt: null,
        paid: false,
        autoDeducted: false,
      });
    }
  }

  const corrections: DemoCorrection[] = [
    {
      id: uuid(300),
      employeeId: workers[2].id,
      employeeName: workers[2].displayName,
      entryId: entries[0].id,
      reason: "Forgot to clock out on Tuesday",
      requested: { clockOut: iso(at(2, 17, 30)) },
      status: "pending",
      createdAt: iso(daysAgo(1)),
    },
    {
      id: uuid(305),
      employeeId: workers[3].id,
      employeeName: workers[3].displayName,
      entryId: entries[1].id,
      reason: "Clocked in late by mistake — was actually on time",
      requested: { clockIn: iso(at(3, 8, 0)) },
      status: "pending",
      createdAt: iso(daysAgo(2)),
    },
  ];

  const leave: DemoLeave[] = [
    {
      id: uuid(400),
      employeeId: workers[0].id,
      employeeName: workers[0].displayName,
      type: "annual",
      startDate: dayStr(daysAgo(-7)),
      endDate: dayStr(daysAgo(-9)),
      hours: "16.00",
      status: "pending",
      note: "Long weekend",
    },
    {
      id: uuid(405),
      employeeId: workers[1].id,
      employeeName: workers[1].displayName,
      type: "sick",
      startDate: dayStr(daysAgo(5)),
      endDate: dayStr(daysAgo(5)),
      hours: "8.00",
      status: "approved",
      note: null,
    },
  ];

  const shifts: DemoShift[] = [];
  let sSeed = 500;
  for (let d = -2; d <= 4; d++) {
    const date = daysAgo(-d);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const w of workers.slice(0, 4)) {
      shifts.push({
        id: uuid(sSeed++),
        employeeId: w.id,
        shiftDate: dayStr(date),
        startMin: 8 * 60 + ((sSeed % 2) * 30),
        endMin: 16 * 60 + ((sSeed % 3) * 30),
        note: null,
      });
    }
  }

  const audit: DemoAudit[] = [];
  const s: DemoState = {
    employees,
    entries,
    breaks,
    jobs,
    corrections,
    leave,
    shifts,
    audit,
    sessionEmployeeId: employees[0].id, // demo signs you in as the admin
    auditSeq: 1,
    settings: {
      locale: { country: "NZ", language: "en", bcp47: "en-NZ", currency: "NZD", weekStart: 1, holidayRegion: "", holidayPayMultiplier: 1 },
      overtime: { dailyThresholdMin: 480, weeklyThresholdMin: 2400, multiplier1: 1.5, multiplier2: 2, daily2ThresholdMin: null },
      rounding: { incrementMin: 1, mode: "nearest" },
      breaks: { autoDeductAfterMin: 360, autoDeductMin: 30 },
      payPeriod: { type: "fortnightly", anchor: "2026-01-05" },
      autoClockout: { enabled: true, maxShiftHours: 14 },
      notifications: { haNotifyEnabled: true, haNotifyService: "notify.notify", smtp: { enabled: false, host: "", port: 587, user: "", from: "" } },
      kiosk: { requireDeviceBinding: false },
      integration: { apiKey: "demo0000api0000key" },
      presence: { enabled: false, pollSec: 60, arriveGraceSec: 120, departGraceSec: 300, ssid: "", notifyOnArrive: true, notifyOnDepart: true },
      antifraud: { geofence: { enabled: false, lat: -36.8485, lng: 174.7633, radiusM: 250, enforce: false }, ipAllowlist: [], ipEnforce: false, photoOnPunch: false },
    },
  };
  return s;
}

// ---------------------------------------------------------------------------
// Helpers over state
// ---------------------------------------------------------------------------

function me(): DemoEmployee {
  return state.employees.find((e) => e.id === state.sessionEmployeeId) ?? state.employees[0];
}
function empName(id: string): string {
  return state.employees.find((e) => e.id === id)?.displayName ?? "Unknown";
}
function jobName(id: string | null): string | null {
  return state.jobs.find((j) => j.id === id)?.name ?? null;
}
function openEntry(empId: string): DemoEntry | undefined {
  return state.entries.find((e) => e.employeeId === empId && e.clockOut == null);
}
function openBreak(entryId: string): DemoBreak | undefined {
  return state.breaks.find((b) => b.timeEntryId === entryId && b.endAt == null);
}
function entryBreaks(entryId: string): DemoBreak[] {
  return state.breaks.filter((b) => b.timeEntryId === entryId);
}
function unpaidBreakMin(entryId: string, until: Date): number {
  return entryBreaks(entryId)
    .filter((b) => !b.paid)
    .reduce((a, b) => {
      const end = b.endAt ? new Date(b.endAt) : until;
      return a + Math.max(0, (end.getTime() - new Date(b.startAt).getTime()) / 60_000);
    }, 0);
}
function workedMin(e: DemoEntry, now = new Date()): number {
  const out = e.clockOut ? new Date(e.clockOut) : now;
  const span = (out.getTime() - new Date(e.clockIn).getTime()) / 60_000;
  return Math.max(0, Math.round(span - unpaidBreakMin(e.id, out)));
}

function sessionResponse(): Json {
  const m = me();
  return {
    session: {
      id: "demo-session",
      expiresAt: iso(new Date(Date.now() + 86400_000)),
      employee: { id: m.id, displayName: m.displayName, role: m.role },
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

interface Req {
  method: string;
  path: string; // without /api prefix, e.g. "/clock/status"
  query: URLSearchParams;
  body: Json | undefined;
}

function ok(data: Json, status = 200): { status: number; body: Json } {
  return { status, body: data };
}

function handle(req: Req): { status: number; body: Json } {
  const { method, path } = req;
  const seg = path.split("?")[0];

  // ---- health / locale ---------------------------------------------------
  if (seg === "/health") return ok({ status: "ok", db: "demo" });
  if (seg === "/locale") {
    const l = state.settings.locale as Json;
    return ok({ language: l.language, bcp47: l.bcp47, currency: l.currency, weekStart: l.weekStart });
  }

  // ---- auth --------------------------------------------------------------
  if (seg === "/auth/session") {
    // Honour an explicit demo sign-out so the PIN flow is exercisable; a reload
    // reseeds and auto-signs the admin back in.
    if (!state.sessionEmployeeId) return ok({ session: null });
    return ok(sessionResponse());
  }
  if (seg === "/auth/whoami") {
    const signedIn = !!state.sessionEmployeeId;
    const m = me();
    return ok({
      ha: { haUserId: "demo_admin", displayName: "Demo User" },
      employee: signedIn ? { id: m.id, displayName: m.displayName, role: m.role } : null,
      bootstrapped: true,
    });
  }
  if (seg === "/auth/kiosk-employees") {
    return ok({
      employees: state.employees
        .filter((e) => e.active)
        .map((e) => ({ id: e.id, displayName: e.displayName, hasPin: e.pin != null })),
    });
  }
  if (seg === "/auth/pin-login" && method === "POST") {
    const empId = String(req.body?.employeeId ?? "");
    const e = state.employees.find((x) => x.id === empId);
    if (!e) return ok({ error: "invalid_credentials" }, 401);
    state.sessionEmployeeId = e.id;
    return ok({ ok: true, employee: { id: e.id, displayName: e.displayName, role: e.role } });
  }
  if (seg === "/auth/claim-admin" && method === "POST") return ok({ claimed: true, employee: { id: me().id, role: "admin" } });
  if (seg === "/auth/logout" && method === "POST") {
    // In demo, "sign out" drops to the not-signed-in view by clearing session.
    state.sessionEmployeeId = "";
    return ok({ ok: true });
  }

  // ---- clock -------------------------------------------------------------
  if (seg === "/clock/status") {
    const e = openEntry(me().id);
    if (!e) return ok({ open: null });
    const ob = openBreak(e.id);
    return ok({
      open: {
        entryId: e.id,
        clockIn: e.clockIn,
        job: e.jobId ? { id: e.jobId, name: jobName(e.jobId)! } : null,
        onBreak: ob ? { breakId: ob.id, startAt: ob.startAt, paid: ob.paid } : null,
        unpaidBreakMin: Math.round(unpaidBreakMin(e.id, new Date())),
      },
    });
  }
  if (seg === "/clock/jobs") {
    return ok({ jobs: state.jobs.filter((j) => j.active).map((j) => ({ id: j.id, name: j.name, code: j.code })) });
  }
  if (seg === "/clock/in" && method === "POST") {
    if (openEntry(me().id)) return ok({ error: "already_clocked_in" }, 409);
    const jobId = (req.body?.jobId as string | null) ?? null;
    const entry: DemoEntry = { id: uuid(idc++ + 700), employeeId: me().id, clockIn: iso(new Date()), clockOut: null, jobId, edited: false, note: null };
    state.entries.push(entry);
    pushAudit({ entityType: "time_entry", entityId: entry.id, action: "clock_in", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ clockIn: entry.clockIn }) });
    return ok({ ok: true, entryId: entry.id });
  }
  if (seg === "/clock/out" && method === "POST") {
    const e = openEntry(me().id);
    if (!e) return ok({ error: "not_clocked_in" }, 409);
    const ob = openBreak(e.id);
    if (ob) ob.endAt = iso(new Date());
    e.clockOut = iso(new Date());
    const wm = workedMin(e);
    pushAudit({ entityType: "time_entry", entityId: e.id, action: "clock_out", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ clockOut: e.clockOut }) });
    return ok({ ok: true, workedMinutes: wm, autoDeductedMin: 0 });
  }
  if (seg === "/clock/break/start" && method === "POST") {
    const e = openEntry(me().id);
    if (!e) return ok({ error: "not_clocked_in" }, 409);
    if (openBreak(e.id)) return ok({ error: "already_on_break" }, 409);
    const b: DemoBreak = { id: uuid(idc++ + 800), timeEntryId: e.id, startAt: iso(new Date()), endAt: null, paid: Boolean(req.body?.paid), autoDeducted: false };
    state.breaks.push(b);
    return ok({ ok: true, breakId: b.id });
  }
  if (seg === "/clock/break/end" && method === "POST") {
    const e = openEntry(me().id);
    const ob = e ? openBreak(e.id) : undefined;
    if (!ob) return ok({ error: "not_on_break" }, 409);
    ob.endAt = iso(new Date());
    return ok({ ok: true });
  }
  if (seg === "/clock/switch-job" && method === "POST") {
    const e = openEntry(me().id);
    if (!e) return ok({ error: "not_clocked_in" }, 409);
    // Close current, open a new entry on the new job (mirrors real switch-job).
    const now = new Date();
    e.clockOut = iso(now);
    const newE: DemoEntry = { id: uuid(idc++ + 900), employeeId: me().id, clockIn: iso(now), clockOut: null, jobId: (req.body?.jobId as string) ?? null, edited: false, note: null };
    state.entries.push(newE);
    return ok({ ok: true, entryId: newE.id });
  }

  // ---- entries (my-hours) ------------------------------------------------
  if (seg === "/entries/mine") {
    const from = new Date(req.query.get("from") ?? daysAgo(14).toISOString());
    const to = new Date(req.query.get("to") ?? new Date().toISOString());
    const rows = state.entries
      .filter((e) => e.employeeId === me().id && new Date(e.clockIn) >= from && new Date(e.clockIn) <= to)
      .sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime())
      .map((e) => ({
        id: e.id,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        edited: e.edited,
        note: e.note,
        job: e.jobId ? { id: e.jobId, name: jobName(e.jobId)! } : null,
        workedMinutes: e.clockOut ? workedMin(e) : null,
        breaks: entryBreaks(e.id).map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt, paid: b.paid, autoDeducted: b.autoDeducted })),
      }));
    return ok({ entries: rows });
  }
  if (seg.startsWith("/entries/") && method === "PATCH") {
    const id = seg.split("/")[2];
    const e = state.entries.find((x) => x.id === id);
    if (!e) return ok({ error: "not_found" }, 404);
    const old = { clockIn: e.clockIn, clockOut: e.clockOut };
    if (req.body?.clockIn) e.clockIn = String(req.body.clockIn);
    if (req.body?.clockOut) e.clockOut = String(req.body.clockOut);
    e.edited = true;
    e.note = (req.body?.reason as string) ?? e.note;
    pushAudit({ entityType: "time_entry", entityId: e.id, action: "self_edit", actorId: me().id, reason: (req.body?.reason as string) ?? null, oldValue: JSON.stringify(old), newValue: JSON.stringify({ clockIn: e.clockIn, clockOut: e.clockOut }) });
    return ok({ ok: true });
  }

  // ---- corrections -------------------------------------------------------
  if (seg === "/corrections" && method === "POST") {
    const c: DemoCorrection = {
      id: uuid(idc++ + 1000),
      employeeId: me().id,
      employeeName: me().displayName,
      entryId: String(req.body?.entryId ?? ""),
      reason: String(req.body?.reason ?? ""),
      requested: (req.body?.requested as DemoCorrection["requested"]) ?? {},
      status: "pending",
      createdAt: iso(new Date()),
    };
    state.corrections.unshift(c);
    pushAudit({ entityType: "correction", entityId: c.id, action: "request", actorId: me().id, reason: c.reason, oldValue: null, newValue: null });
    return ok({ ok: true, id: c.id });
  }
  if (seg === "/corrections/pending") {
    return ok({ corrections: state.corrections.filter((c) => c.status === "pending") });
  }
  if (/^\/corrections\/[^/]+\/(approve|reject)$/.test(seg) && method === "POST") {
    const [, , id, action] = seg.split("/");
    const c = state.corrections.find((x) => x.id === id);
    if (!c) return ok({ error: "not_found" }, 404);
    c.status = action === "approve" ? "approved" : "rejected";
    if (action === "approve") {
      const e = state.entries.find((x) => x.id === c.entryId);
      if (e) {
        if (c.requested.clockIn) e.clockIn = c.requested.clockIn;
        if (c.requested.clockOut) e.clockOut = c.requested.clockOut;
        e.edited = true;
      }
    }
    pushAudit({ entityType: "correction", entityId: id, action, actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ status: c.status }) });
    return ok({ ok: true });
  }

  // ---- leave -------------------------------------------------------------
  if (seg === "/leave/mine") {
    return ok({
      balances: { annual: 92.5, sick: 40, bereavement: 24, alt_holiday: 16 },
      requests: state.leave
        .filter((l) => l.employeeId === me().id || me().role !== "employee")
        .map((l) => ({ id: l.id, type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, status: l.status, note: l.note })),
    });
  }
  if (seg === "/leave" && method === "POST") {
    const l: DemoLeave = {
      id: uuid(idc++ + 1100),
      employeeId: me().id,
      employeeName: me().displayName,
      type: String(req.body?.type ?? "annual"),
      startDate: String(req.body?.startDate ?? dayStr(new Date())),
      endDate: String(req.body?.endDate ?? dayStr(new Date())),
      hours: String(req.body?.hours ?? "8"),
      status: "pending",
      note: (req.body?.note as string) ?? null,
    };
    state.leave.unshift(l);
    pushAudit({ entityType: "leave_request", entityId: l.id, action: "request", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ type: l.type, hours: l.hours }) });
    return ok({ ok: true, id: l.id });
  }
  if (seg === "/leave/pending") {
    return ok({ requests: state.leave.filter((l) => l.status === "pending") });
  }
  if (/^\/leave\/[^/]+\/(approve|reject)$/.test(seg) && method === "POST") {
    const [, , id, action] = seg.split("/");
    const l = state.leave.find((x) => x.id === id);
    if (!l) return ok({ error: "not_found" }, 404);
    l.status = action === "approve" ? "approved" : "rejected";
    pushAudit({ entityType: "leave_request", entityId: id, action, actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ status: l.status }) });
    return ok({ ok: true });
  }

  // ---- roster ------------------------------------------------------------
  if (seg === "/roster" && method === "GET") {
    const from = req.query.get("from") ?? "0000";
    const to = req.query.get("to") ?? "9999";
    return ok({ shifts: state.shifts.filter((s) => s.shiftDate >= from && s.shiftDate <= to).map((s) => ({ ...s, employeeName: empName(s.employeeId) })) });
  }
  if (seg === "/roster/mine") {
    const from = req.query.get("from") ?? "0000";
    const to = req.query.get("to") ?? "9999";
    return ok({ shifts: state.shifts.filter((s) => s.employeeId === me().id && s.shiftDate >= from && s.shiftDate <= to) });
  }
  if (seg === "/roster/compare") {
    const date = req.query.get("date") ?? dayStr(new Date());
    const shifts = state.shifts
      .filter((s) => s.shiftDate === date)
      .map((s, i) => ({
        rosterId: s.id,
        employeeName: empName(s.employeeId),
        startMin: s.startMin,
        endMin: s.endMin,
        status: (["ok", "late", "in_progress", "upcoming", "no_show"] as const)[i % 5],
        lateMin: i % 5 === 1 ? 12 : 0,
        actualIn: i % 5 === 1 ? iso(new Date()) : null,
      }));
    return ok({ date, shifts });
  }
  if (seg === "/roster" && method === "POST") {
    const s: DemoShift = {
      id: uuid(idc++ + 1200),
      employeeId: String(req.body?.employeeId ?? state.employees[3].id),
      shiftDate: String(req.body?.shiftDate ?? dayStr(new Date())),
      startMin: Number(req.body?.startMin ?? 480),
      endMin: Number(req.body?.endMin ?? 960),
      note: (req.body?.note as string) ?? null,
    };
    state.shifts.push(s);
    pushAudit({ entityType: "roster", entityId: s.id, action: "create", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ shiftDate: s.shiftDate }) });
    return ok({ ok: true, id: s.id });
  }
  if (/^\/roster\/[^/]+\/cancel$/.test(seg) && method === "POST") {
    const id = seg.split("/")[2];
    state.shifts = state.shifts.filter((s) => s.id !== id);
    pushAudit({ entityType: "roster", entityId: id, action: "cancel", actorId: me().id, reason: null, oldValue: null, newValue: null });
    return ok({ ok: true });
  }

  // ---- manager -----------------------------------------------------------
  if (seg === "/manager/board") {
    const now = new Date();
    const clockedIn = state.entries
      .filter((e) => e.clockOut == null)
      .map((e) => {
        const ob = openBreak(e.id);
        return {
          entryId: e.id,
          employeeId: e.employeeId,
          employeeName: empName(e.employeeId),
          clockIn: e.clockIn,
          onBreak: !!ob,
          breakSince: ob?.startAt ?? null,
        };
      });
    const todayClosedMin: Record<string, number> = {};
    for (const e of state.entries) {
      if (e.clockOut && dayStr(new Date(e.clockIn)) === dayStr(now)) {
        todayClosedMin[e.employeeId] = (todayClosedMin[e.employeeId] ?? 0) + workedMin(e);
      }
    }
    return ok({ now: iso(now), clockedIn, todayClosedMin });
  }
  if (seg === "/manager/pay-periods" && method === "GET") {
    const periods = [0, 1, 2].map((i) => {
      const end = daysAgo(i * 14);
      const start = daysAgo(i * 14 + 13);
      return { id: uuid(1300 + i), startAt: iso(start), endAt: iso(end), lockedAt: i === 2 ? iso(daysAgo(i * 14 - 1)) : null };
    });
    return ok({ periods });
  }
  if (/^\/manager\/pay-periods\/[^/]+\/timesheet$/.test(seg)) {
    const id = seg.split("/")[3];
    const period = { id, startAt: iso(daysAgo(13)), endAt: iso(new Date()), lockedAt: null };
    const rows = state.employees
      .filter((e) => e.role !== "admin")
      .map((e) => {
        const worked = 60 * (60 + (e.displayName.length % 20));
        const ordinary = Math.min(worked, 4800);
        const ot1 = Math.max(0, worked - 4800);
        return {
          employeeId: e.id,
          employeeName: e.displayName,
          totals: { workedMin: worked, ordinaryMin: ordinary, ot1Min: ot1, ot2Min: 0, statT15Min: 0, altHolidaysEarned: e.displayName.length % 2, editedDays: e.displayName === "Jordan Lee" ? 1 : 0, complianceFlagCount: 0 },
        };
      });
    return ok({ period, rows });
  }
  if (/^\/manager\/pay-periods\/[^/]+\/lock$/.test(seg) && method === "POST") {
    pushAudit({ entityType: "pay_period", entityId: seg.split("/")[3], action: "lock", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ lockedAt: iso(new Date()) }) });
    return ok({ ok: true, lockedAt: iso(new Date()) });
  }
  if (seg === "/manager/audit/verify") return ok({ ok: true, broken_at: null, detail: "chain intact (demo)" });
  if (seg === "/manager/audit") {
    const entityType = req.query.get("entityType");
    let rows = state.audit;
    if (entityType) rows = rows.filter((r) => r.entityType === entityType);
    return ok({ rows: rows.slice(0, 200) });
  }

  // ---- admin -------------------------------------------------------------
  if (seg === "/admin/employees" && method === "GET") {
    return ok({
      employees: state.employees.map((e) => ({
        id: e.id,
        displayName: e.displayName,
        role: e.role,
        active: e.active,
        haUsername: e.haUsername,
        hasPin: e.pin != null,
        notifyService: e.notifyService,
        presenceEntity: e.presenceEntity,
        createdAt: iso(daysAgo(40)),
      })),
    });
  }
  if (seg === "/admin/employees" && method === "POST") {
    const e: DemoEmployee = {
      id: uuid(idc++ + 1400),
      displayName: String(req.body?.displayName ?? "New Person"),
      role: (req.body?.role as DemoEmployee["role"]) ?? "employee",
      active: true,
      haUsername: null,
      pin: (req.body?.pin as string) ?? null,
      notifyService: null,
      presenceEntity: null,
    };
    state.employees.push(e);
    pushAudit({ entityType: "employee", entityId: e.id, action: "create", actorId: me().id, reason: null, oldValue: null, newValue: JSON.stringify({ displayName: e.displayName, role: e.role }) });
    return ok({ employee: { id: e.id, displayName: e.displayName, role: e.role } }, 201);
  }
  if (/^\/admin\/employees\/[^/]+\/pin$/.test(seg) && method === "POST") {
    const id = seg.split("/")[3];
    const e = state.employees.find((x) => x.id === id);
    if (e) e.pin = String(req.body?.pin ?? "0000");
    return ok({ ok: true });
  }
  if (/^\/admin\/employees\/[^/]+$/.test(seg) && method === "PATCH") {
    const id = seg.split("/")[3];
    const e = state.employees.find((x) => x.id === id);
    if (!e) return ok({ error: "not_found" }, 404);
    const old = { role: e.role, active: e.active, haUsername: e.haUsername };
    if (req.body?.role !== undefined) e.role = req.body.role as DemoEmployee["role"];
    if (req.body?.active !== undefined) e.active = Boolean(req.body.active);
    if (req.body?.haUsername !== undefined) e.haUsername = (req.body.haUsername as string) || null;
    if (req.body?.displayName !== undefined) e.displayName = String(req.body.displayName);
    if (req.body?.notifyService !== undefined) e.notifyService = (req.body.notifyService as string) || null;
    if (req.body?.presenceEntity !== undefined) e.presenceEntity = (req.body.presenceEntity as string) || null;
    pushAudit({ entityType: "employee", entityId: id, action: "update", actorId: me().id, reason: null, oldValue: JSON.stringify(old), newValue: JSON.stringify({ role: e.role, active: e.active, haUsername: e.haUsername }) });
    return ok({ ok: true });
  }
  if (seg === "/admin/ha-entities") return ok({ available: false, presence: [], notify: [] });
  if (seg === "/admin/devices/bind" && method === "POST") return ok({ device: { id: uuid(9999), name: String(req.body?.name ?? "Kiosk") } }, 201);
  if (seg === "/admin/settings" && method === "GET") return ok({ settings: state.settings });
  if (seg === "/admin/settings" && method === "PATCH") {
    state.settings = deepMerge(state.settings, req.body ?? {}) as Json;
    pushAudit({ entityType: "settings", entityId: "1", action: "update", actorId: me().id, reason: null, oldValue: null, newValue: null });
    return ok({ settings: state.settings });
  }
  if (seg === "/admin/integration" && method === "GET") {
    return ok({ apiKey: (state.settings.integration as Json).apiKey, status: { packageInstalled: false, cardInstalled: false, packagesIncludeDetected: false }, packageYaml: "# demo — integration not installed" });
  }
  if (seg === "/admin/integration/install" && method === "POST") return ok({ ok: true, status: { packageInstalled: true, cardInstalled: true, packagesIncludeDetected: true } });
  if (seg === "/admin/integration/key" && method === "POST") {
    (state.settings.integration as Json).apiKey = "demo" + Math.random().toString(16).slice(2, 14);
    return ok({ apiKey: (state.settings.integration as Json).apiKey, haReloaded: null });
  }
  if (seg === "/admin/jobs" && method === "GET") return ok({ jobs: state.jobs });

  // Unmatched -> JSON 404 (mirrors Hono notFound).
  return ok({ error: "not_found", path }, 404);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (base && patch && typeof base === "object" && typeof patch === "object" && !Array.isArray(base) && !Array.isArray(patch)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
    return out;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Public entry: called by api-client in demo mode. Mirrors fetch() semantics
// enough for the app (returns a real Response so the caller is unchanged).
// ---------------------------------------------------------------------------

export async function demoFetch(fullPath: string, init?: RequestInit): Promise<Response> {
  if (!state) state = seed();
  // fullPath is like "<base>/api/clock/status?x=1"; strip everything up to /api.
  const apiIdx = fullPath.indexOf("/api/");
  const rel = apiIdx >= 0 ? fullPath.slice(apiIdx + 4) : fullPath; // keep leading "/..."
  const [pathOnly, qs = ""] = rel.split("?");
  const method = (init?.method ?? "GET").toUpperCase();
  let body: Json | undefined;
  if (init?.body) {
    try {
      body = JSON.parse(String(init.body));
    } catch {
      body = undefined;
    }
  }
  const res = handle({ method, path: pathOnly, query: new URLSearchParams(qs), body });
  // Small latency so optimistic UI + spinners are visible, like a real network.
  await new Promise((r) => setTimeout(r, 120));
  return new Response(JSON.stringify(res.body), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

/** Test/util: force a fresh seed. */
export function _reseed() {
  state = seed();
}
