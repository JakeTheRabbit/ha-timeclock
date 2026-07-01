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
3. Admin → Employees: add staff + PINs; bind the wall tablet as a kiosk.
4. Settings: adjust overtime/rounding/pay-period anchor/anti-fraud as needed.

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
