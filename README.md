# Time Clock — Home Assistant add-on

A full-featured employee time-clock system that runs as a Home Assistant add-on,
reached through the HA sidebar (Ingress) on the local network. Kiosk-first: a
shared wall tablet with per-employee PIN + device binding.

**Design pillar — immutable audit.** `time_entries` holds the mutable current
truth; `audit_log` is append-only, protected by (1) app-layer INSERT-only
writes, (2) Postgres triggers that raise on UPDATE/DELETE, and (3) a SHA-256
hash-chain that makes any tampering evident. Staff can edit their own times, but
every edit writes a new value plus an audit row (old→new + reason). Deletion is
impossible.

## Stack

Next.js 15 (App Router) · shadcn/ui · Tailwind v4 · TanStack Query · React Hook
Form + Zod · Hono API · **PostgreSQL 16 bundled inside the add-on** · Drizzle ORM
· node-cron. Timezone `Pacific/Auckland`.

## Repository layout

```
repository.yaml          HA add-on repository manifest
timeclock/               the add-on (slug: timeclock)
  config.yaml            add-on manifest (ingress, panel, apis)
  build.yaml             per-arch base image
  Dockerfile             multi-stage: build Next standalone → HA base runtime
  rootfs/                s6-overlay v3 services (postgres → migrate → app → ingress)
  webapp/                Next.js 15 project (App Router + Hono API + Drizzle)
```

## Install (as an add-on repository)

Settings → Add-ons → Add-on Store → ⋮ → Repositories → add this repo URL, then
install **Time Clock**.

# Time Clock Feature List And To Do

Time Clock is a Home Assistant add-on for employee time tracking on a shared
kiosk tablet, with manager approval workflows and immutable audit history.

## Current release

Version `0.2.0` adds HA SSO (accounts follow the HA login), the
`timeclock-card` dashboard card (live tiles, logs, totals, graphs), Android
companion-app widgets for one-tap clock in/out from a phone, and pushed
`sensor.timeclock_*` entities — on top of the P12 feature-complete base.

## Features

- **HA SSO**: employees are signed in automatically on any device via the HA
  account they opened the panel with; kiosk PIN sign-in for shared tablets
  (device binding optional, off by default).
- **Dashboard card** `custom:timeclock-card`: per-person live status and
  today/week totals with one-tap clock in/out, punch log, week / month /
  quarter / year totals, and graphs (stacked daily bars, 26-week trend, punch
  map, year race) — installed with one click from Admin → Settings.
- **Android widgets**: generated `script.timeclock_<name>_toggle` per employee;
  add an HA companion Actions widget to clock in/out from the home screen.
- **Sensors**: `sensor.timeclock_summary`, `sensor.timeclock_<name>` (status +
  hour totals), `sensor.timeclock_<name>_today` (numeric) — pushed ~2 s after
  every punch.
- Clock in/out, paid and unpaid breaks, job switching, live timers, and offline
  punch replay.
- Immutable audit trail with append-only audit rows, Postgres trigger guards,
  application role limits, and SHA-256 hash-chain verification.
- Staff self-corrections with required reasons and manager approval queues.
- NZ payroll rules for overtime, public holidays, Mondayisation, Matariki,
  stat-day pay, alternative holidays, rounding, and ERA break-compliance flags.
- Rostering with scheduled-vs-actual views, late/no-show detection, leave
  requests, approvals, ledger balances, and annual-leave accrual.
- Manager dashboard with live who's-in board, pay-period sign-off, immutable
  period locking, admin unlock with reason, and audit viewer.
- Reports and exports: day-level CSV, PDF summary, generic payroll CSV, and
  Xero/iPayroll adapter stubs.
- Notifications and maintenance: Home Assistant notify service, SMTP interface,
  auto-clockout, daily database backups, restore verification, and accrual cron.
- Anti-fraud controls: geofence, CIDR/IP allowlist, photo-on-punch, device
  binding, PIN rate limiting, and punch forensics.

## To do

- Replace Xero and iPayroll stubs with production API integrations.
- Finish SMTP credential handling and production email templates.
- Add Playwright end-to-end coverage for HA Ingress and kiosk flows.
- Add release automation for packaged Home Assistant add-on builds.
- Add seeded demo data and screenshot coverage for kiosk, manager, approvals,
  reporting, and settings screens.

