# Pull request

## What this does

<!-- One or two lines. What changes and why. -->

## Checks

- [ ] `npx tsc --noEmit` is clean
- [ ] `npm run build` succeeds
- [ ] `npm test` is green against a real PostgreSQL (`TEST_DATABASE_URL` set)
- [ ] New behaviour has a test
- [ ] Migrations are idempotent (re-run safe)
- [ ] Audit guarantees are intact (no path can update or delete audit rows)
- [ ] No broad Home Assistant reload added (reloads stay scoped to changed files)

## Notes

<!-- Anything a reviewer should know. Screenshots for UI changes. -->
