# Admin and Manager guide

Everything an admin or manager needs to run Time Clock. If you just need to clock
in and out, read the [Employee guide](employee-guide.md) instead.

## Contents

- [First-run setup](#first-run-setup)
- [Adding staff](#adding-staff)
- [How people sign in](#how-people-sign-in)
- [Kiosk devices](#kiosk-devices)
- [Payroll rules and settings](#payroll-rules-and-settings)
- [The dashboard card](#the-dashboard-card)
- [Phone widgets](#phone-widgets)
- [Presence reminders](#presence-reminders)
- [Manager: approvals, pay periods, audit](#manager-approvals-pay-periods-audit)
- [Reports and payroll export](#reports-and-payroll-export)
- [Backups](#backups)
- [Troubleshooting](#troubleshooting)

## First-run setup

1. Install and start the add-on, open the panel from the sidebar.
2. Tap **First-time setup: claim admin**. The Home Assistant user who does this
   claims the seeded Admin account. This only works once, before anyone is
   linked, so do it yourself.
3. Go to Admin, Employees and add your staff.
4. Go to Admin, Settings and set your site rules.
5. Optional but recommended: Admin, Settings, Home Assistant integration,
   Install. This writes the dashboard card and the phone-widget scripts.

## Adding staff

Admin, Employees, Add employee. Give a name and a role. Roles stack in
privilege: employee, lead, manager, admin.

- **employee** clocks in and out, sees their own hours, requests leave and
  corrections.
- **lead** also sees reports.
- **manager** also gets the who-is-in board, the approval queues, and pay-period
  sign-off.
- **admin** also gets employee management and settings.

For each person set:

- **PIN** if they will use the kiosk. Tap Set PIN. PIN-less staff still show on
  the kiosk grid but greyed out, so a missing PIN reads as "ask the admin", not
  "I have disappeared".
- **Home Assistant username** so their HA login signs them in automatically. It
  accepts either their HA username (case-insensitive) or their HA user id.
- **Active** toggle. Deactivating removes them from the kiosk grid and sign-in
  but keeps all their history. It is a switch with instant feedback, so you will
  see straight away if it worked.

## How people sign in

There are two sign-in paths and they coexist.

**Home Assistant single sign-on.** If a person's Home Assistant username is set
on their employee record, opening the panel signs them in as themselves on any
device. This is what makes the admin reachable from any computer. Signing out
shows the kiosk PIN pad again and suppresses auto sign-in for 12 hours or until
the next PIN login, so a shared tablet can still switch between people.

**Kiosk PIN.** Tap your name on the grid, enter your PIN. This is the shared-
tablet path.

Device binding is off by default. Every request already arrives authenticated
through Home Assistant, so PINs work from any browser. If you want to restrict
PIN login to specific tablets, turn on `kiosk.requireDeviceBinding` in Settings
and bind your kiosks (see below).

## Kiosk devices

Only relevant if you turned on device binding. Walk to the tablet, open the
panel, go to Admin, Employees, and tap **Bind this device as kiosk**. That
browser is now a bound kiosk. Repeat per tablet.

With binding on, PIN login from an unbound device is refused with a clear
message rather than looking like a wrong PIN.

## Payroll rules and settings

Admin, Settings. The friendly controls cover the common ones. The Advanced
section is the full settings document as JSON, validated on save, and every save
is audited.

What you can set:

- **Overtime.** Daily threshold (default 8 hours), weekly threshold (default 40),
  the first and second multipliers, and an optional second daily tier.
- **Rounding.** Increment (1, 5, 10, or 15 minutes) and mode (nearest, up, down).
  This affects reported time only. Raw punches are never changed.
- **Breaks.** After how long a shift auto-deducts a meal break, and how many
  minutes.
- **Pay period.** Weekly or fortnightly, and the anchor Monday that periods tile
  from.
- **Auto-clockout.** A safety net that closes a shift left open too long.
- **Notifications.** The Home Assistant notify service to use, and SMTP (wired,
  credentials deferred).
- **Anti-fraud.** Geofence, IP allowlist, and photo on punch. Each is either
  flag-only or enforced. Off by default.

The New Zealand rules that are computed for you: public holidays including
Mondayisation pairs and Matariki, statutory-day time and a half, alternative
holidays, and Employment Relations Act break-compliance flags.

## The dashboard card

Admin, Settings, Home Assistant integration, Install. This writes the card into
your config and the per-employee scripts.

One-time Home Assistant steps, which the Integration panel checks for you:

1. `configuration.yaml` needs `packages: !include_dir_named packages` under
   `homeassistant:`. Add it if the panel says it is missing, then restart Home
   Assistant once.
2. Settings, Dashboards, three-dot menu, Resources, Add resource:
   `/local/timeclock-card.js` as a JavaScript module.
3. Add a card to any dashboard: `type: custom:timeclock-card`.

The card reads `sensor.timeclock_summary` and `sensor.timeclock_history`. It
shows a live tile per person with a one-tap clock in and out, a punch log,
week/month/quarter/year totals, and graphs (stacked daily bars, a 26-week trend,
a punch map that draws every shift at its real time of day, and a year total
race). It updates within a couple of seconds of any punch.

The card and scripts regenerate themselves when the roster changes. The install
never runs a full Home Assistant reload, so it will not disturb your other
automations.

## Phone widgets

The Install step creates a `script.timeclock_<name>_toggle` for each employee.
On the person's phone, in the Home Assistant companion app, add a home-screen
widget, choose Actions, and pick their `Time Clock: <name> in/out` script. One
tap toggles their clock. The punch is audited exactly like a kiosk punch.

## Presence reminders

Notify people to clock in when they reach the work network and to clock out when
they leave. It never punches for them; it sends a notification with a button they
tap.

Set it up:

1. Admin, Employees. For each person set a **Notify service** (their companion-
   app notify target) and a **Presence entity**. Both are dropdowns populated
   live from your Home Assistant: their `device_tracker` or `person` entity, a
   connectivity `binary_sensor`, or a companion-app Wi-Fi SSID sensor.
2. If you picked a Wi-Fi SSID sensor, set the work SSID in Admin, Settings,
   Presence reminders.
3. Admin, Settings, Presence reminders. Turn it on. Defaults are a 2-minute
   arrive grace and a 5-minute depart grace so a brief Wi-Fi drop does not nag.

How it works: the add-on polls the presence entities, debounces the change, and
sends the notification itself. There are no per-employee Home Assistant
automations, so editing your roster never reloads anything on the box. The one
static automation it installs turns the notification button tap into a punch.

Two things to know. If a phone leaves Wi-Fi with no cell signal, the clock-out
notification queues until it reconnects. And a cold add-on restart seeds presence
silently, so no one gets a burst of notifications when the add-on boots.

## Manager: approvals, pay periods, audit

Manager in the sidebar (lead and above).

- **Who is in.** Live board of current status.
- **Approvals.** Correction requests and leave requests, with approve and decline
  buttons. Every action gives you a confirmation.
- **Pay periods.** Pick a period, review the timesheet, then sign off and lock
  it. A locked period is immutable. An admin can unlock, but that requires a
  reason and is audited.
- **Audit.** The full audit trail with live hash-chain verification. If the chain
  ever fails to verify, something touched the database out of band and the viewer
  will say so.

## Reports and payroll export

From the reports routes and the pay-periods screen:

- Timesheet CSV (day level) and a PDF summary.
- Payroll export CSV. Xero and iPayroll adapters are stubbed and return a clear
  "not implemented" until wired.

## Backups

The add-on runs a daily `pg_dump` with a restore verification into its persisted
volume, and keeps two weeks. Because the whole database lives on the add-on's
`/data` volume, a Home Assistant snapshot also captures it.

## Troubleshooting

**I cannot get into the admin on a different computer.** Set your Home Assistant
username on your employee record (Admin, Employees). Then opening the panel signs
you in automatically anywhere.

**A PIN is rejected on a new computer.** Device binding is on. Either bind that
device (Admin, Employees, Bind this device as kiosk) or turn binding off in
Settings.

**The dashboard card shows "Waiting for sensor".** The add-on has not pushed the
sensor yet. Make sure the add-on is running, then reload the dashboard. The
sensor updates every five minutes and on every punch.

**Clock buttons stopped working after I rotated the API key.** If the rotate
message warned that Home Assistant did not reload, restart Home Assistant once so
it picks up the new key.

**Recorder is getting large.** Exclude the heavy history sensor:

```yaml
recorder:
  exclude:
    entities:
      - sensor.timeclock_history
```
