# Time Clock Feature List And To Do

Time Clock is a Home Assistant add-on for employee time tracking on a shared
kiosk tablet, with manager approval workflows and immutable audit history.

## Current release

Version `0.1.3` is feature-complete through P12. It includes the first-boot
admin seed fix, HA Ingress routing, bundled PostgreSQL 16, migrations, and CI
coverage.

## Features

- Kiosk PIN sign-in with device binding.
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
