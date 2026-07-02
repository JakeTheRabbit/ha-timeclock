# Changelog

## 0.2.0 — HA SSO, dashboard card, Android widgets

Feedback round (Callum): clock in/out from anywhere, accounts that follow the
HA login, PINs that work on any computer.

- **HA SSO**: an employee whose *HA username* matches the HA account opening
  the panel is signed in automatically, on any device. Matches the opaque HA
  user id or the human username (case-insensitive). Sign-out suppresses SSO
  for 12 h / until the next PIN login so shared kiosks can switch users.
- **Fix "PIN doesn't work on another computer"**: device binding is now an
  opt-in antifraud setting (`kiosk.requireDeviceBinding`, default **off**) —
  the 403 `device_not_bound` no longer masquerades as a wrong PIN. The kiosk
  grid also lists staff without PINs (greyed out) instead of hiding them.
- **Sensors**: `sensor.timeclock_summary` (+ per-employee status and
  numeric-hours sensors) pushed on every punch and every 5 min.
- **Dashboard card** (`timeclock-card`): live status tiles with one-tap clock
  in/out, punch log, week/month/quarter/year totals, and graphs — stacked
  daily bars, 26-week trends, a punch map (every shift at its real time of
  day), year race.
- **Android companion widgets**: one-click integration install generates
  `script.timeclock_<name>_toggle` per employee (auto-regenerated when the
  roster changes) — add as an Actions widget to clock in/out from a phone.
- **External API**: key-authenticated `/api/ext/*` (punch/status/summary);
  punches run through the same audited path as kiosk punches.
- New: role-aware home screen; Admin → Settings → Integration panel
  (install/status/API key). Add-on now maps `homeassistant_config` (rw) to
  install the package + card.

## 0.1.3 — fix first-boot: seed the claimable Admin

- Fresh installs had an empty employees table, so "claim admin" returned 409
  (no_claimable_admin). migrate.sh now seeds one Admin employee idempotently
  after migrations.

## 0.1.2 — fix ingress 400s on API responses (stuck loading panel)

- The ingress proxy buffered chunked upstream responses and set
  Content-Length while still forwarding the upstream
  `Transfer-Encoding: chunked` header. Supervisor's aiohttp rightly rejects
  the illegal combination with 400 ("Content-Length can't be present with
  Transfer-Encoding"), so every dynamic API call failed and the panel hung on
  the loading splash (static HTML had explicit lengths and worked — which is
  why assets rendered but the app never came up).
- Proxy now strips all RFC 7230 hop-by-hop headers (transfer-encoding,
  connection, keep-alive, te, trailer, upgrade, proxy-*) before responding.

## 0.1.1 — fix Supervisor build

- `ARG BUILD_FROM` moved above the first `FROM` (global scope). Declared
  mid-file it was stage-scoped, so the runtime `FROM ${BUILD_FROM}` resolved
  blank and the on-box build failed ("base name should not be blank").
  Verified with a real `docker buildx build` using the Supervisor's exact
  invocation.

## 0.1.0 — P3–P12: feature-complete

- **P3 clock**: in/out, paid/unpaid breaks, auto-deduct meal break (settings-
  driven), job/project switching, live timer kiosk screen. Every punch audited.
- **P4 edits**: self-edit with mandatory reason (entry flagged `edited`
  forever), correction request → lead/manager approval workflow, my-hours view.
- **P5 rules**: NZ overtime engine (daily>8h / weekly>40h, configurable
  multipliers + optional 2x tier), computed NZ public holidays (Easter
  computus, Mondayisation pairs, Matariki table, Auckland Anniversary),
  stat-day time-and-a-half + alternative-holiday assessment, punch rounding
  (report-time only), ERA break-compliance flags, whole-app settings doc
  (zod-validated, audited).
- **P6 rostering**: shifts (NZ wall-clock, DST-correct), scheduled-vs-actual
  comparison, late / no-show / in-progress detection.
- **P7 leave**: request → approval, ledger-based balances, 4/52 annual-leave
  accrual engine (idempotent bookmark), manual adjustments.
- **P8 manager**: live who's-in board, pay-period materialization, timesheet
  engine (OT attribution, stat pay, compliance + edited flags), sign-off +
  LOCK (locked periods immutable; admin unlock requires reason), compliance
  audit viewer with live chain verification.
- **P9 reports**: day-level CSV, PDF summary (pdfkit), payroll adapter seam —
  CSV working, Xero/iPayroll stubbed (501 with guidance).
- **P10 notifications**: HA notify via Supervisor proxy, SMTP interface wired
  (creds deferred), auto-clockout safety net (cron 15min), daily pg_dump
  backup + pg_restore verify, weekly accrual cron.
- **P11 anti-fraud**: geofence (haversine, flag or enforce), IP/WiFi allowlist
  (CIDR), photo-on-punch (JPEG to /data/photos), device-bind + PIN from P2,
  punch forensics stored on entries.
- **P12 polish**: kiosk offline queue (localStorage replay, server honours
  bounded `clientQueuedAt` + flags `offline_queued`), i18n seam, dark kiosk
  theme, manager/roster/leave/settings UIs.
- Fix: pdfkit must be `serverExternalPackages` — bundling broke its font
  loading in the standalone build.

## 0.0.3 — P2 auth: sessions, RBAC, kiosk PIN + device binding

- Two identity planes: HA Ingress headers (`X-Remote-User-*`) identify the
  panel opener; employee PIN + bound device is the punch-authority. Provider
  seam (`AuthProvider`) keeps a future remote login a drop-in.
- DB-backed revocable sessions + HMAC-signed cookie; secret generated once to
  `/data/session_secret`.
- PIN auth: scrypt (no native deps), per-user salt, timing-safe compare, 5-fail
  60s rate limiter per employee+device.
- Device binding: raw token only in the kiosk cookie, sha256 in DB; admin
  "bind this device"; zero-devices bootstrap auto-binds the first kiosk.
- RBAC employee<lead<manager<admin, `requireRole` guard on /api/admin/*.
- First-boot bootstrap: first HA user claims the seeded Admin (409 afterwards).
- Ingress proxy strips X-Remote-User-*/X-Ingress-Path unless the request comes
  from the Supervisor source IP (172.30.32.2) or loopback — header spoofing
  from other containers is neutralized.
- UI: kiosk PIN pad (`/pin`), Admin → Employees (create, role, PIN, activate,
  device bind). All auth-relevant mutations audited; chain stays verified.
- Tests: 32 passing (unit pin/session/rbac/device + 11-step integration flow
  against real Postgres).

## 0.0.2 — P1 database + immutable audit

- Schema: `employees`, `time_entries` (mutable truth), `audit_log` (append-only)
  via idempotent SQL migrations, applied by `migrate.sh` as postgres on boot.
- **Audit triple-lock**: (1) runtime connects as `timeclock_app` with
  SELECT+INSERT only on `audit_log`; (2) triggers `RAISE EXCEPTION` on
  UPDATE/DELETE/TRUNCATE — superuser included; (3) SHA-256 hash-chain computed
  in a `BEFORE INSERT` trigger (advisory-lock serialized), `verify_audit_chain()`
  detects any out-of-band tamper.
- Drizzle ORM client + schema; append-only `appendAudit()` writer with
  canonical (sorted-key) payload serialization.
- Health route now pings Postgres (`db: up|down|skipped`).
- Tests: 12 passing, incl. real-Postgres proof that raw-psql UPDATE/DELETE/
  TRUNCATE all fail and that chain verification catches tampering. CI runs the
  proof against a postgres:16 service.

## 0.0.1 — P0 scaffold

- Add-on packaging: `config.yaml`, `build.yaml`, `Dockerfile`, s6-overlay v3
  service tree (`prepare → postgres → migrate → timeclock → ingress`).
- Bundled PostgreSQL 16 on `/data/postgres` (loopback only, `initdb` on first
  boot).
- Ingress reverse-proxy (`proxy.js`) that rewrites the `/ha-ingress` sentinel to
  HA's real `X-Ingress-Path` — Next.js assets resolve inside the ingress iframe.
- Next.js 15 App Router app with Hono API; `GET api/health` returns JSON.
- Blank P0 panel loads in the HA sidebar.
