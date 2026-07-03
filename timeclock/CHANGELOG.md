# Changelog

## 0.6.1 — paid/unpaid break choice + Jobs admin (feedback round 4, Ben)

- **Break type is the employee's choice now.** The clock screen's single
  "Start break" (which silently recorded every break as unpaid) is replaced by
  two buttons: **Rest break (paid)** and **Meal break (unpaid)** — matching the
  NZ break semantics the compliance engine already used. Until now the UI could
  only record unpaid breaks, so every 2h+ shift was flagged
  `missing_rest_break` on manager timesheets; paid rest breaks fix that (and
  are not deducted from worked time).
- **Admin → Jobs.** The jobs API existed since 0.1.0 but had no UI, so the
  clock screen's switch-job menu (which only renders when jobs exist) was
  unreachable. New Jobs page: add jobs (name + optional costing code), edit,
  activate/deactivate. Once at least one job exists, employees get the job
  picker on clock-in and the **switch job** menu while clocked in — switching
  closes the current entry and opens a new one on the new job, both audited.
- All new strings translated in the five language packs; new paid-break
  integration test.

## 0.6.0 — native HA theming, live demo, HA profile pictures

Three feature areas so the add-on looks and feels like part of Home Assistant,
plus a fix for the remaining in-panel navigation 404.

- **Fix "back to Home" 404 inside the HA panel.** Next emitted the app root link
  as a BARE `/ha-ingress` (basePath root has no trailing slash), which the proxy
  rewrote to a bare-token URL `/api/hassio_ingress/<token>` — and HA-core's
  ingress route does NOT match a bare token (it 404s before auth; only
  `/<token>/` and `/<token>/<path>` match), so any full-page nav to Home 404'd.
  Fixed with `trailingSlash: true` + `skipTrailingSlashRedirect: true` in
  `next.config.ts` (root URLs now end in `/<token>/`, and the API — whose
  fetches are built without trailing slashes — is served without a 308) and by
  mapping the ingress-root `/` to `SENTINEL + "/"` in `proxy.js`. Verified
  against a live standalone+proxy: root, `/pin/`, `/admin/employees/` and their
  RSC payloads carry only slashed token URLs; `/api/health` GET and a
  `/api/auth/pin-login` POST return normally with zero redirects.

- **Native Home Assistant theming.** The whole app is now themed with Home
  Assistant's own design tokens (colours lifted verbatim from
  `home-assistant/frontend` — HA blue, card/background/text/divider colours,
  12px card radius, the Roboto/Noto font stack), mapped onto the shadcn/ui
  layer so every screen — kiosk, clock, my-hours, manager, admin, roster,
  leave, settings — picks it up. Adds a **dark / light / system** toggle and an
  **accent-colour picker** (the standard HA theme-picker palette), discoverable
  on the Home launcher and in Admin → Settings → Appearance. Choices persist per
  device (localStorage) and are applied before first paint (no theme flash);
  first run follows the OS `prefers-color-scheme`. Default is dark + HA blue
  (`#03a9f4`), matching the previous look. The fixed bottom nav is unchanged —
  only restyled.
- **Live demo on GitHub Pages** (https://jaketherabbit.github.io/ha-timeclock/).
  A `NEXT_PUBLIC_DEMO=1` build swaps the API layer for an in-browser fixture
  backend (seeded staff, several weeks of punches, breaks, corrections, leave,
  rosters, pay periods, timesheets, audit rows). Clock in/out, breaks, edits,
  approvals and roster changes mutate in-memory state so they visibly work
  within a session; a **page reload reseeds** (it is a static site, so state is
  not persisted). A "DEMO" banner marks it. The demo shim is client-only and
  tree-shaken out of the production standalone build; the add-on build is
  unchanged. Deployed by `.github/workflows/demo.yaml` (static export →
  `actions/deploy-pages`).
- **Profile pictures from Home Assistant.** Employee avatars are sourced from
  HA `person` entities: the add-on reads person states via the Supervisor Core
  proxy and matches person → employee by the person's `user_id` against the
  employee's linked HA username (the same link SSO uses), falling back to a
  display-name match. Pictures are proxied server-side through
  `GET /api/avatars/:id` (the `SUPERVISOR_TOKEN` never reaches the browser) and
  cached briefly. Avatars show on the kiosk staff grid, the manager live board,
  the employees admin list, and the session header, with a coloured **initials
  fallback** whenever a person has no picture (or outside HA). Requires that the
  HA person has a picture configured and is linked to the employee's HA
  username; unmatched staff simply show initials.
- Tests: added avatar matching/fallback unit tests and a real-Postgres avatar
  route integration suite (Supervisor mocked). i18n parity kept across all five
  language packs (new Appearance strings translated).

## 0.5.1 — sidebar for all users + fix back-navigation 404s

- `panel_admin: false`: the sidebar panel now shows for non-admin HA users
  (staff). HA's default hides ingress panels from everyone outside the admin
  group — staff couldn't see the Time Clock at all.
- Ingress proxy now rewrites `text/x-component` (Next.js RSC flight payloads).
  Client-side navigations were seeding router/history state with raw internal
  `/ha-ingress/*` URLs, so the in-app back button (e.g. Admin → back to Home)
  requested those paths against the HA host and 404'd.

## 0.5.0 — localization: countries, holidays, and language packs

Use it outside New Zealand without hand-editing config.

- **Country presets** (Admin -> Settings -> Region and language): New Zealand,
  USA, UK, Ireland, Canada, Australia, Germany, France, Switzerland, Sweden,
  Denmark. Picking a country sets week start, currency, date/number format,
  timezone, and a starting overtime rule. Every field stays editable.
- **Public holidays per country and region** via the `date-holidays` library
  (US state, German Bundesland, Swiss canton, UK nation, Canada province,
  Australia state). New Zealand keeps its own tuned engine (Matariki,
  Mondayisation, Auckland Anniversary) and its Holidays Act stat-pay — NZ
  behaviour is unchanged.
- **Locale-aware formatting** everywhere (dates, times, numbers, currency).
- **Language packs** for the employee-facing UI: English, German, French,
  Swedish, Danish. Set the language in Settings. Missing strings fall back to
  English, so the UI never blanks. The non-English translations are a starting
  point and should be checked by a native speaker before staff rely on them.
- Overtime and holiday presets are editable DEFAULTS, not legal advice. This
  add-on tracks hours and exports them; it does NOT calculate income tax
  (US federal/state, PAYE, Lohnsteuer, etc.) — that is your payroll system's job.

## 0.4.2 — dashboard card header fix + polished repo

- Card (v1.1.1): the header read the clocked-in count from a sensor attribute
  that never existed (the count is the entity state), so it showed "undefined
  clocked in". It now derives the count from the per-employee statuses, so the
  header is always correct. Found while producing the repo screenshots.
- Repo: README with screenshots and badges, MIT LICENSE, admin/manager and
  employee guides, CONTRIBUTING, SECURITY, and GitHub issue/PR templates. No
  functional add-on change beyond the card fix.

## 0.4.1 — make API-key rotation honest about HA reloads

- On the box, `rest_command.reload` can return 400 (e.g. a pre-existing
  rest_command elsewhere in a big facility config failing strict reload
  validation). It's harmless when rest_command content is unchanged, but on an
  API-key rotation a silent failure would leave HA sending the OLD key →
  punches 401 until an HA restart. The reload path now: (1) logs the HA
  response body so the cause is diagnosable, (2) returns per-service success,
  and (3) the "Rotate API key" action reports whether HA actually reloaded —
  the UI warns "restart HA once" if it didn't. No behavior change when reloads
  succeed. Still never `homeassistant.reload_all`.

## 0.4.0 — presence reminders (clock in/out when you arrive/leave)

Feedback round 3 (Ben): notify people to clock in when they join the work
Wi-Fi, and to clock out when they leave.

- **Presence reminders**: set a Notify service + Presence entity per employee
  (Admin → Employees, dropdowns discovered live from HA — device_tracker,
  person, connectivity binary_sensor, or a companion-app Wi-Fi SSID sensor),
  toggle on in Admin → Settings → Presence reminders. When someone arrives an
  actionable **"Clock in?"** notification lands on their phone; when they
  leave, **"Clock out?"**. One tap punches. Never auto-punches (staff keep
  control); arrive/depart grace periods absorb Wi-Fi flapping; a cold start
  never fires a burst of notifications.
- Runs **inside the add-on** (polls HA, debounces, sends the notifications) —
  **no per-employee HA automations**, so roster changes never reload anything
  on the box.
- The only HA-side addition is one tiny **static** automation
  (`timeclock_notify_actions`) that turns a notification button tap into a
  punch. It lives in its own package file (`timeclock_automation.yaml`),
  separate from the roster scripts (`timeclock.yaml`) and the rest_command
  (`timeclock_handlers.yaml`), so `automation.reload` fires only on an add-on
  upgrade that revises the handler — never on roster edits or key rotation.
  Still never `homeassistant.reload_all`.
- Hardening: notify-service string is strictly validated before use, and
  employee display-name slug collisions no longer produce duplicate YAML keys.
- DB: employees gain nullable `notify_service` / `presence_entity`
  (migration 0010). 155 tests (new presence unit + integration suites).

## 0.3.0 — UI overhaul + stop disturbing the rest of Home Assistant

Feedback round 2 (Ben): "it's crashing HA", "navigation and UI suck",
"deactivate doesn't work".

- **No more facility-wide reloads**: the integration installer previously
  called `homeassistant.reload_all` after writing the package — on a box
  running production automations out of packages that restarted everything
  (looked like an HA crash). Now reloads only `rest_command` + `script`, and
  only when the generated file content actually changed.
- **Recorder-friendly sensors**: `sensor.timeclock_summary` is now slim
  (status + period totals; attribute-stable while idle so recorder dedupes);
  graph series + punches moved to `sensor.timeclock_history`, pushed only on
  punches + hourly. Card v1.1.0 reads both.
- **Complete UI rebuild** (shadcn/ui, dark, mobile-first): fixed bottom nav
  in thumb reach (Home / Clock / Hours, + Manager for leads, + Admin for
  admins), top bar with an in-app back button on every screen (never relies
  on the browser/app back button), Home is a role-aware launcher menu, big
  touch targets, tables collapse to cards on phones.
- **Every action now gives visible feedback** (toasts). "Deactivate didn't
  work" was a server-side success with an invisible error path on failure —
  it's now an optimistic toggle switch with rollback + error toast, covered
  by regression tests (deactivate hides from kiosk grid, reactivate
  restores, role changes audited).
- Employees admin: set PIN via dialog (no more window.prompt), HA username
  editable inline (SSO linking), clearer statuses.

## 0.2.1 — fix sensor push on small-ICU Node (Alpine)

- `nzDateOf`/pay-period date strings were built with locale `.format()`;
  Alpine Node ships English-only ICU so en-CA fell back to M/D/YYYY and
  every downstream parse failed ("Invalid time value" — ha-push dead, no
  sensors). Now assembled from `formatToParts` (locale-proof) and the image
  installs `icu-data-full` so human-facing en-NZ dates render correctly.

## 0.2.0 — HA SSO, dashboard card, Android widgets

Feedback round: clock in/out from anywhere, accounts that follow the
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
