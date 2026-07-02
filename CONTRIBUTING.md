# Contributing

Issues and pull requests are welcome. This is a real add-on running on a real
site, so the bar is: it has to work, and it has to not break the audit log.

## Reporting a bug

Open an issue with the bug template. Include:

- Add-on version (Settings, Add-ons, Time Clock).
- Home Assistant version and install type (OS, Supervised).
- What you did, what happened, what you expected.
- Relevant lines from the add-on log (Settings, Add-ons, Time Clock, Log). Strip
  anything sensitive first.

Security problems do not go in public issues. See [SECURITY.md](SECURITY.md).

## Requesting a feature

Use the feature template. Say what you are trying to do and why, not just the
solution you have in mind. The why is what makes it buildable.

## Working on the code

The app lives in `timeclock/webapp` (Next.js 15, Hono, Drizzle, PostgreSQL). The
add-on packaging is the rest of `timeclock/`.

```bash
cd timeclock/webapp
npm install

# a PostgreSQL 16 for tests and local runs
docker run -d --name tc-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=tc \
  -p 55432:5432 postgres:16-alpine

# type check, build, and the full test suite
npx tsc --noEmit
npm run build
TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:55432/tc" npm test
```

The test suite runs against that real PostgreSQL, including a proof that raw SQL
cannot update, delete, or truncate the audit log. If your change touches the DB,
the audit immutability tests must still pass.

## Before you open a PR

- `npx tsc --noEmit` is clean.
- `npm run build` succeeds.
- `npm test` is green against a real PostgreSQL.
- New behaviour has a test. Migrations are idempotent (`IF NOT EXISTS`, `CREATE
  OR REPLACE`) because they re-run on every boot.
- Do not weaken the audit guarantees. The append-only log, the restricted
  database role, the triggers, and the hash chain are the point of the project.

## A note on the Home Assistant integration

This add-on runs on boxes that also run other automations. The install and
refresh code must never call a broad reload (no `homeassistant.reload_all`). Keep
reloads scoped to the domains whose generated file actually changed. There are
tests and comments guarding this. Please keep them.
