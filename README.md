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

## Build phases

P0 scaffold · P1 DB + audit immutability · P2 auth/RBAC/kiosk · P3 clock/breaks ·
P4 edits/corrections · P5 overtime + NZ holidays + rounding · P6 rostering ·
P7 leave · P8 manager dashboard + pay-period lock · P9 reports/export ·
P10 notifications · P11 anti-fraud · P12 polish.

**Current:** P0 complete — add-on scaffold, bundled Postgres under s6, Ingress
proxy, blank panel loads.
