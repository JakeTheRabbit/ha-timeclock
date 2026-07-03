# Time Clock

Employee time-clock add-on. Kiosk-first (shared tablet on the HA sidebar), with
an immutable, hash-chained audit trail.

Full guides on GitHub:
[Admin and Manager guide](https://github.com/JakeTheRabbit/ha-timeclock/blob/main/docs/admin-guide.md)
and [Employee guide](https://github.com/JakeTheRabbit/ha-timeclock/blob/main/docs/employee-guide.md).

## Appearance (theme)

The app is themed to match the Home Assistant frontend, so it feels native in
the sidebar. Set it in **Home** (launcher) or **Admin → Settings → Appearance**:

- **Theme**: Dark, Light, or System (follows your device's `prefers-color-scheme`).
- **Accent colour**: the standard Home Assistant theme-picker palette. Default
  is HA blue (`#03a9f4`).

Choices are saved **per device** in the browser (localStorage), so a shared
kiosk and a personal phone can differ. First run defaults to dark + HA blue.

## Profile pictures

Employee avatars come from Home Assistant `person` entities. If a person in HA
has a picture and is linked to the employee (by the employee's **HA username** —
the same link used for SSO, matched against the person's user id or name), that
picture shows on the kiosk staff grid, the manager live board, the employees
admin list, and the top-bar session header. The picture is fetched by the add-on
via the Supervisor proxy and served from `GET /api/avatars/:id`, so the
Supervisor token never reaches the browser.

No picture, or no match? The avatar falls back to the person's **initials** on a
coloured circle. Nothing to configure for the fallback — it just works.

## Region and language

Admin -> Settings -> Region and language. Pick a country to load defaults for
date/number formatting, week start, currency, timezone, public holidays, and a
starting overtime rule: New Zealand, USA, UK, Ireland, Canada, Australia,
Germany, France, Switzerland, Sweden, Denmark. Every field stays editable, and
you can set an optional holiday region (US state, German Bundesland, Swiss
canton, UK nation, Canada province, Australia state).

Public holidays come from the `date-holidays` library for every country except
New Zealand, which keeps its own computed engine (Matariki, Mondayisation,
Auckland Anniversary) and Holidays Act stat-pay. For other countries a day is
flagged as a public holiday and paid at the "worked public holiday" multiplier
you set (default 1, i.e. no premium — set it to match your agreement).

The UI is translated into English, German, French, Swedish, and Danish. Set the
language in the same panel. Anything not translated falls back to English, so
the interface never blanks. The non-English translations are a solid starting
point generated for this release; have a native speaker check them before staff
rely on them.

Two honest limits. Overtime and holiday presets are editable starting points,
not legal advice — check them against your local law or awards. And this add-on
does not calculate income tax (US federal/state, UK PAYE, German Lohnsteuer,
and so on); it tracks hours and exports them to your payroll system, which does
the tax.

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

- `packages/timeclock.yaml` — one `script.timeclock_<name>_toggle` per employee
  (regenerated automatically when the roster changes, and on every add-on start).
- `packages/timeclock_handlers.yaml` — `rest_command.timeclock_punch` plus one
  static automation (`timeclock_notify_actions`) that turns presence-reminder
  button taps into punches (changes only on API-key rotation / add-on upgrade).
- `www/timeclock-card.js` — the dashboard card (auto-updated on add-on updates).

Splitting the package into two files keeps reloads narrow: a roster edit only
touches the scripts file (→ `script.reload`), while the static handlers file is
left alone (→ no `rest_command` / `automation` reload). See below.

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

The installer reloads granularly and only when the file in question actually
changed: `script.reload` when the scripts file changes; `rest_command.reload` +
`automation.reload` when the handlers file changes. It never calls
`homeassistant.reload_all`, so it will not disturb other automations on the box.

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

## Presence reminders (clock in/out when you arrive/leave)

People forget to punch. When someone's phone joins the work network, the add-on
can send them a **"Clock in?"** notification with a one-tap button; when they
leave, a **"Clock out?"** one. It is **notify-only — it never auto-punches**.
The human always taps (keeping control is deliberate: supply runs, stepping
out mid-shift, and working off-site shouldn't be clocked automatically). No tap,
no punch.

**Set it up:**

1. **Admin → Settings → Presence reminders** → turn it **on**. Tune the poll
   interval and the arrive/depart grace here if the defaults (poll 60 s, arrive
   120 s, depart 300 s) don't suit.
2. **Admin → Employees** → for each person set their **Notify service** and
   **Presence entity** from the dropdowns. Both are populated live from HA
   (device trackers, `person`, connectivity/presence binary sensors, Wi-Fi/SSID
   sensors for presence; `notify.*` services for the notification). A person with
   either field blank is simply skipped.
3. If you're using a **Wi-Fi SSID sensor** for presence (e.g. the companion
   app's "SSID" sensor), also fill in the **Wi-Fi SSID** field in Settings so
   "present" means *connected to that network* rather than *connected to any*.

**How it detects presence:**

- `device_tracker` / `person` → present when `home`.
- `binary_sensor` (connectivity/presence/occupancy) → present when `on`.
- Wi-Fi/SSID `sensor` → present when the state matches the configured **SSID**
  (or, with no SSID set, any connected-looking network name).

A change only counts once it has held for the **arrive/depart grace**, so a Wi-Fi
blip or a quick drive-by doesn't fire a reminder. A reminder is sent only when
the punch is actually needed — arriving while clocked out, or leaving while
clocked in. Cold start (add-on boot) never notifies; it silently adopts whatever
state it first sees.

**Where it runs:** the whole poller lives **inside the add-on** — there is no
per-employee HA automation, so adding, removing, or editing staff never reloads
anything on the facility box. The integration installs exactly **one** tiny
static automation, `timeclock_notify_actions`, whose only job is to turn a
notification button tap into a punch. It changes only on API-key rotation /
add-on upgrade, so it never disturbs the box's other automations.

**Tap-to-clock flow:** the notification arrives in the **HA Companion app**;
tapping **Clock in** / **Clock out** fires the `timeclock_notify_actions`
automation (action id `TIMECLOCK_IN__<id>` / `TIMECLOCK_OUT__<id>`), which calls
`rest_command.timeclock_punch` back into the add-on. The punch is dispatched
through the same code path as a kiosk punch — auto-deduct, audit, and anti-fraud
settings all apply.

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
