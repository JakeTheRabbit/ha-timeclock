# Forum Post Draft

Title: Time Clock add-on: kiosk employee clocking with immutable audit trail

Hi all,

I have been building a Home Assistant add-on called **Time Clock** for small
teams that need a shared wall-tablet time clock inside the HA sidebar.

The main idea is a kiosk-first employee clock: staff sign in with a PIN, clock
in/out, take breaks, switch jobs, and managers can review corrections, leave,
pay periods, and exports. It is designed around an immutable audit trail so
time records can be corrected, but not silently rewritten or deleted.

Screenshot:

![Time Clock home](https://raw.githubusercontent.com/JakeTheRabbit/ha-timeclock/main/docs/screenshots/timeclock-home.png)

Repository:

https://github.com/JakeTheRabbit/ha-timeclock

## Current status

The add-on is currently at `0.1.3` and is feature-complete through the planned
P12 milestone set. It includes a first-boot admin claim flow, Home Assistant
Ingress support, bundled PostgreSQL 16, database migrations, and CI tests.

## Features

- Kiosk PIN sign-in with device binding.
- Clock in/out, paid and unpaid breaks, job switching, live timers, and offline
  punch replay.
- Immutable audit log with append-only audit rows, Postgres trigger guards, app
  role limits, and SHA-256 hash-chain verification.
- Staff self-corrections with required reasons and manager approval queues.
- NZ payroll rules for overtime, public holidays, Mondayisation, Matariki,
  stat-day pay, alternative holidays, rounding, and ERA break-compliance flags.
- Rostering, scheduled-vs-actual views, late/no-show detection, leave requests,
  approvals, ledger balances, and annual-leave accrual.
- Manager dashboard with live who's-in board, pay-period sign-off, immutable
  period locking, admin unlock with reason, and audit viewer.
- CSV and PDF reports, generic payroll CSV export, and Xero/iPayroll adapter
  stubs.
- Home Assistant notifications, SMTP interface, auto-clockout, daily database
  backups, restore verification, and weekly accrual cron.
- Anti-fraud controls: geofence, CIDR/IP allowlist, photo-on-punch, device
  binding, PIN rate limiting, and punch forensics.

## Install

1. In Home Assistant, go to **Settings -> Add-ons -> Add-on Store**.
2. Open the three-dot menu, choose **Repositories**, and add:

   `https://github.com/JakeTheRabbit/ha-timeclock`

3. Install **Time Clock**, start it, and open the sidebar panel.
4. Use the first-boot claim flow to claim the seeded Admin user.
5. Add employees, set PINs, bind the kiosk device, and configure payroll,
   rounding, anti-fraud, and notification settings.

## To do

- Replace the Xero and iPayroll stubs with real API integrations.
- Finish SMTP credential handling and production email templates.
- Add browser end-to-end coverage for HA Ingress and kiosk flows.
- Add packaged release automation for Home Assistant add-on builds.
- Add seeded demo data and more screenshots for kiosk, manager, approvals,
  reports, and settings screens.

Feedback is welcome, especially from people running HA in small workshops,
farms, trades, or other places where a local wall-tablet clock is a better fit
than a cloud SaaS product.
