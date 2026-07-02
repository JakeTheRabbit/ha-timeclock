# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through
GitHub's private vulnerability reporting: the repository's Security tab, then
"Report a vulnerability".

Include what you found, how to reproduce it, and the impact as you see it. You
will get an acknowledgement, and a fix or a plan, as fast as is practical for a
small project.

## Scope

This add-on handles staff time records and an append-only audit trail. The parts
worth the most scrutiny:

- The append-only audit log and its three guards: the restricted database role,
  the triggers that reject update, delete, and truncate, and the SHA-256 hash
  chain.
- The ingress proxy, which strips the Home Assistant identity headers unless the
  request comes from the trusted Supervisor source.
- The external clock API, which is authenticated by a key and dispatches punches
  through the same audited path as the kiosk.
- PIN handling: scrypt hashing, timing-safe comparison, and the rate limiter.

## What runs where

The database listens on loopback only inside the add-on container. The runtime
connects as a non-superuser role that cannot mutate the audit log. Migrations run
separately as the owner. If you find a way around any of that, it is exactly the
kind of report worth sending.
