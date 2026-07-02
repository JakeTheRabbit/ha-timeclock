# Time Clock

Employee time-clock add-on. Kiosk-first (shared tablet on the HA sidebar), with
an immutable, hash-chained audit trail.

## Configuration

| Option      | Default            | Notes                                   |
| ----------- | ------------------ | --------------------------------------- |
| `timezone`  | `Pacific/Auckland` | Display timezone for all human-facing times. Storage stays UTC. |
| `log_level` | `info`             | `trace`…`fatal`.                         |

## Features (v0.1.0 — feature-complete)

- **Kiosk**: staff grid → PIN → clock in/out, breaks (auto-deduct meal break),
  job switching, live timer, offline punch queue (WiFi blips survive).
- **Immutable audit**: append-only `audit_log` (role grants + triggers +
  SHA-256 hash chain). Staff edit their own times only with a reason; every
  edit is flagged and audited. Deletion impossible. Chain verifiable live.
- **NZ payroll rules**: overtime (daily>8h / weekly>40h, configurable
  multipliers), computed NZ public holidays incl. Mondayisation + Matariki,
  stat-day time-and-a-half + alternative holidays, rounding policies, ERA
  break-compliance flags.
- **Rostering**: shifts, scheduled-vs-actual, late / no-show board.
- **Leave**: requests + approvals, ledger balances, 4/52 annual accrual.
- **Manager**: live who's-in board, correction/leave approval queues,
  pay-period sign-off + LOCK (immutable), audit viewer.
- **Reports**: timesheet CSV + PDF, payroll export — generic CSV working now;
  Xero / iPayroll adapters stubbed for later API push.
- **Notifications**: HA `notify.*` via Supervisor; SMTP interface wired,
  credentials deferred. Auto-clockout safety net.
- **Anti-fraud**: per-employee PIN + device binding, geofence, IP/WiFi
  allowlist, photo-on-punch — each flag-only or enforced.
- **Backups**: daily `pg_dump` + verify to `/data/backups` (14-day retention).

## First-boot setup

1. Install, start, open the sidebar panel.
2. Tap **First-time setup: claim admin** (the first HA user becomes Admin).
3. Admin → Employees: add staff + PINs, and set each person's **HA username**
   so their HA login signs them in automatically (see below).
4. Settings: adjust overtime/rounding/pay-period anchor/anti-fraud as needed.
5. Settings → **Home Assistant integration** → Install (dashboard card +
   widget scripts).

## Signing in: HA SSO + kiosk PINs

- **HA SSO (default)** — an employee whose `HA username` matches the HA account
  they opened the panel with is signed in automatically, on any device. The
  field accepts either the HA username (case-insensitive) or the opaque HA
  user id. Signing out shows the PIN pad and suppresses SSO for 12 h (or until
  the next PIN login), so a shared kiosk can switch users freely.
- **Kiosk PINs** — the staff grid shows everyone; people without a PIN appear
  greyed out until an admin sets one.
- **Device binding is OFF by default** (`settings.kiosk.requireDeviceBinding`).
  Every request already arrives HA-authenticated through Ingress, so PINs work
  from any browser. Turn it on to restrict PIN login to admin-bound kiosk
  devices (Admin → Settings JSON), e.g. to stop punches from personal phones.

## Dashboard card (`timeclock-card`)

Admin → Settings → **Home Assistant integration → Install** writes:

- `packages/timeclock.yaml` — `rest_command.timeclock_punch` + one
  `script.timeclock_<name>_toggle` per employee (regenerated automatically when
  the roster or API key changes, and on every add-on start).
- `www/timeclock-card.js` — the dashboard card (auto-updated on add-on updates).

One-time HA prep:

1. `configuration.yaml` needs `homeassistant: packages: !include_dir_named packages`
   (the Integration panel shows whether this is detected), then restart HA.
2. Settings → Dashboards → Resources → add `/local/timeclock-card.js` as a
   **JavaScript module**.
3. Add a manual card: `type: custom:timeclock-card`.

The card shows per-person live status + today/week totals with one-tap clock
in/out, a punch log, week/month/quarter/year totals, and graphs (stacked daily
bars, 26-week trend lines, a punch map that draws every shift at its real time
of day, and a year-total race). All data comes from `sensor.timeclock_summary`.

## Sensors pushed to HA

| Entity | State | Notes |
| ------ | ----- | ----- |
| `sensor.timeclock_summary` | people clocked in | slim per-employee attrs (status + today/week/month/quarter/year); attribute-stable while idle |
| `sensor.timeclock_history` | date | heavy graph series (42-day daily, 26-week weekly, recent punches); pushed only on punches + hourly |
| `sensor.timeclock_<name>` | `in` / `break` / `out` | today/week/month/quarter/year hour attributes — automate on it |
| `sensor.timeclock_<name>_today` | hours today | numeric, for native HA history graphs |

Summary + per-employee sensors update ~2 s after every punch and every 5
minutes in between. To keep the recorder lean, exclude the history sensor:

```yaml
recorder:
  exclude:
    entities:
      - sensor.timeclock_history
```

The installer reloads only `rest_command` and `script` (never
`homeassistant.reload_all`) and only when the generated package actually
changed — it will not disturb other automations on the box.

## Android widget (companion app)

Employees can clock in/out from their phone home screen — no need to be at
the kiosk (supply runs, lunch, working off-site):

1. Install the integration (above) — this creates
   `script.timeclock_<name>_toggle` for every employee.
2. In the **HA Companion app**: long-press the home screen → Widgets →
   **Home Assistant** → *Actions* (button) widget.
3. Pick the person's `Time Clock: <name> in/out` script, give it a label/icon.

One tap toggles their clock; the punch is audited exactly like a kiosk punch
(times recorded, visible in Manager → audit). `sensor.timeclock_<name>` can be
added as a widget too, to see current status at a glance.

## External API (what the widgets call)

`POST /api/ext/punch` on the add-on (internal hostname, port 8099) with header
`x-timeclock-key: <API key>`; body `{"employee": "<id|ha-username|name>",
"action": "in"|"out"|"toggle"}`. Also `GET /api/ext/summary` and
`GET /api/ext/status/<employee>`. The key lives in Admin → Settings →
Integration (rotate any time; the installed package updates itself). Punches
dispatch through the same code path as kiosk punches — auto-deduct, audit, and
anti-fraud settings all apply.

## How Ingress routing works (why there's a proxy)

Next.js emits **root-absolute** asset URLs (`/_next/...`). Inside the HA Ingress
iframe those would resolve to `https://<ha>/_next/...` and 404, because HA serves
the add-on under a per-session path (`/api/hassio_ingress/<token>/`).

The app is therefore built with `basePath = /ha-ingress` (a sentinel). A tiny
Node reverse-proxy (`/etc/timeclock/proxy.js`, the public `ingress` service)
swaps that sentinel for HA's real `X-Ingress-Path` on every text response and
prepends it on inbound requests. Result: assets and links route back through
Ingress with no 404s, and direct (non-ingress) access still works.

## Data & backups

The Postgres cluster lives on the persisted `/data/postgres` volume and survives
add-on updates. `initdb` runs once on first boot. Daily logical backups land in
`/data/backups` (from P12). Use HA's snapshot/backup (`backup: hot`) for
add-on-level backups.

## Service startup order (s6-overlay v3)

`prepare` (dirs + initdb) → `postgres` → `migrate` (ensure DB / run migrations)
→ `timeclock` (Next app on 127.0.0.1:3000) → `ingress` (public proxy on :8099).

## Maintenance notes

- **Base image tag** (`build.yaml`) and **`postgresql16`** package track the
  base's Alpine version — bump together when upgrading the base.
- Postgres listens on loopback only; auth is `trust` because it is unreachable
  off-box. Do not expose port 5432.
