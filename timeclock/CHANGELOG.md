# Changelog

## 0.14.1 — clock-in photo validation

- When a clock-in requires a photo, the server validates it before recording
  the time entry. The kiosk can retry after a photo validation error.

## 0.14.0 — consistency, kiosk, admin depth

Staff
- **Roster** is a week strip (respects the site week start): shift bars per
  day, today highlighted, "Next: Tue 08:00–16:30", rostered vs worked so far,
  week steppers. Times follow the site language/12h setting.
- **My hours** groups days by week with "Xh of usual Yh" and collapses other
  weeks; the calendar has a legend, tints leave and public holidays, rings
  usual workdays with nothing recorded, and shows the rostered shift for a
  future day.
- **Profile (/me)**: change your own PIN, pick a language for this device, set
  your phone notification service; theme moved here from Home.
- **Kiosk**: signs out 5 s after a punch on a shared kiosk ("tap to stay");
  PIN backspace deletes one digit (hold to clear), keyboard input, tries left
  after a wrong PIN; staff list has search, last-used-first and an "in" dot.
- **Offline punches are per person**: a punch queued offline only replays for
  the person who made it (server rejects a replay for anyone else).

Managers / admins
- **Insights**: shifts, bars and day cells open that person's day; a worker
  row filters the page; every number compares with the previous period;
  phone layout fixed.
- **Audit log**: names instead of IDs, field-by-field old ⇒ new, readable
  types/actions, server-side filters (type, person, dates, text) and paging.
- **Employees**: searchable Active / Inactive list; each person opens a sheet
  (Access / Pay / Presence) with links to their week and what they're owed.
- **Settings**: one Save / Discard bar for the page; real forms for pay
  period, overtime, rounding, auto-deducted breaks, auto clock-out and the
  payroll export format; Advanced (JSON) kept; validation errors under the
  field.
- **New screens**: Devices (rename, revoke, bind, notification test), Leave
  balances (balances, ledger, adjust, run accrual).
- **Exports**: one "Payroll export" button using the configured format, other
  formats in a menu, warning on an unlocked period, "last exported" stamp
  (exports are now audited).

Everywhere
- One **status badge** style (pending, approved, disputed, locked, paid,
  edited, …) readable in light and dark themes.
- Manager and admin pages and server notifications are **translated** into
  all 5 languages; notifications use the site language.

## 0.13.0 — context where decisions get made

Staff
- **Clock screen**: when clocked out, "Last out · today · this week of usual ·
  next shift"; job prefilled from the roster / last entry; the timer and day
  total survive a job switch. Break guidance: rest/meal progress, "Rest ends
  10:42" (amber when over), and a warning before clock-out when a meal break
  would be auto-deducted.
- **Home**: live status card — clock in/out in one tap, today / week vs usual,
  next shift, disputes banner, pending leave.
- **Leave**: dates and hours prefilled from usual workdays (skips weekends and
  public holidays), "3 days · 24h · 40h left after this", balance per type;
  requests grouped Pending / Upcoming / Past with the manager's note and a
  Withdraw button. Server now counts pending requests against the balance
  (two pending requests could overbook before).
- **Corrections**: day cards show Correction pending / approved / declined;
  on an approved day with several start/finishes you pick which to correct.
- **Smart defaults** use the last 28 days, skip leave and public holidays, and
  use the rostered shift when there is one; a weekday is "usual" only when
  worked on 2+ of the last 4.
- **Day editor** uses time-only inputs (day is fixed) with automatic next-day
  rollover for overnight finishes; break row stacks on phones.
- Staff are notified when leave or a correction is approved or declined.

Managers
- **Dashboard**: "On the clock" shows today's total and progress to rostered
  end, plus who's rostered but not in (late / due in / didn't show). Correction
  cards show old ⇒ new, the hours change, the day's hour strip and Open day.
  Leave cards show balance after approval, who else is off, who's rostered,
  a decline reason and Approve all.
- **Timesheet review** opens on everyone ready to approve, grouped by person
  and week, with hour strips, breaks, rostered times and +/− vs usual;
  Approve all / per person; staff changes grouped by person → day with
  "Acknowledge + approve day"; Reopen uses a proper dialog.
- **Pay periods**: lock readiness checklist per person (open shifts, disputes,
  unapproved days, pending corrections / leave) with links; "Lock anyway";
  each person expands into the period's days with named flags.
- **Pay**: opens on whoever is owed most, last pay period range, entries
  grouped by week with subtotals, Select all unpaid / this week, note
  prefilled from the last one with today's date, locale currency, mobile fix.

API: /clock/status (todayWorkedMin, shiftStart, breaks, breakRule),
/leave/:id/cancel, /leave/pending (balance, alsoOff, rostered),
/corrections/pending (original, day, dayEntries), /corrections/mine (day,
range), /review/days/all, /manager/pay-periods/:id/readiness,
/pay/employees (unpaidCents, lastNote), /manager/leave.

## 0.12.0 — fixes + quick ease-of-use wins

Fixes
- **Clock-in with geofence / photo-on-punch**: the clock screen now sends the
  phone's location (when a geofence is set) and opens the camera for a photo
  (when photo-on-punch is on). Before, every punch was refused when either
  was enforced, and non-enforced geofences flagged every punch "geo_missing".
- **Roster week** ended a day early in NZ (UTC date) — the 7th day's shifts
  were missing.

Ease of use
- **Plain-language errors** everywhere (clock, hours, leave, roster, manager
  pages) instead of raw codes like `already_clocked_in`; 5 languages.
- **Deep links into Entries**: `/manager/entries?employeeId=…&day=…[&edit=1]`
  opens that person's day (and the day editor). Used from Timesheet review
  (name, date, edit button) and the dashboard's "On the clock" board.
- **PIN sign-in** goes straight to the clock.
- **Disputes** have an "Open this day" button and the day is dotted amber on
  the calendar.
- **Day editor**: reason chips (forgot clock-out / clock-in / break, left site,
  wrong time, clocked by mistake), prefilled with the most likely one from what
  changed; a failed save keeps your edits when nothing was written.
- **Running shifts** count live on the calendar, day cards and totals (were 0h).
- **Pay periods** open on the latest finished period still to sign off, with
  older/newer steppers and status labels. Leads see who locks instead of a
  Lock button that fails; admins get **Unlock** with a reason.
- **Timesheet review**: a day that can't be approved says why (still clocked
  in → link to close it; dispute open; no time).
- **Bottom bar**: staff get Roster + Leave; leads get Leave.
- **Offline punches** show "Clocked in — waiting to sync" with the time, so
  nobody taps twice.

## 0.11.0 — calendar, whole-day editor, smart defaults

- **Calendar** on **My hours** and **Manager → Entries**: month view, hours per
  day, a 24-hour strip per day, approved days green, days needing a look
  dotted amber. Click a day to jump to it; empty days offer "Add time".
- **Day cards**: one card per day, start/finishes in time order, with a
  **24-dot hour strip** (work / break / off). Replaces the one-card-per-entry
  manager list that was sorted newest-first inside a day.
- **Whole-day editor**: "Fix times" / "Edit day" opens every start/finish on
  the day together — change, **add** or **remove** any of them plus their
  breaks, one reason for the lot. A **Gantt strip** at the top shows how it
  all lines up (work, paid break, unpaid break) with the day total, and
  overlaps / breaks outside a shift are flagged before saving.
- **Smart defaults**: new times start from the person's usual start/finish
  (median of their recent days); an extra start/finish fills the biggest gap
  in the day; "Add missed time" picks the most recent usual workday with
  nothing recorded; new breaks land mid-way through the longest unbroken
  stretch (30 min unpaid on a 5h+ shift without a meal break, else 10 min
  paid).

## 0.10.0 — staff day editing & timesheet review

Staff now have full control of their own days until a manager approves them.

- **Edit any unapproved day** (the old "day of + day after" window is gone).
  On **My hours**, staff can change start/finish times, **add or remove
  breaks** (including auto-deducted ones), **add extra start/finish pairs** on
  a day they left site and came back, **add a missed day** they never clocked
  in for, and **remove** an entry. Every change needs a reason.
- **Approved days lock.** Once a manager approves a day, staff can't change it
  (they can still send a correction request). Managers can still edit it.
  Manager/admin can **Reopen** an approved day with a reason.
- **Timesheet review** (Manager → Timesheet review): every staff change is
  listed with before ⇒ after and the employee's reason. **Acknowledge** = read
  it (not an approval); **Acknowledge all** for bulk. **Dispute** opens a
  message thread with the employee (HA push to the employee's notify service
  if set); **Resolve** closes it. Approve days one at a time or all ready days
  at once — days with an open shift or open dispute can't be approved.
- Managers can now **add and remove entries and breaks** for anyone on
  **Edit entries**.
- Shifts of one person may no longer overlap; breaks may not overlap.
- New migration `0013_day_review.sql`: `day_approvals`, `modifications`,
  `modification_messages`; correction rows follow a removed entry.
- API: `POST /api/entries`, `DELETE /api/entries/:id`,
  `DELETE /api/entries/:id/breaks/:breakId` (reason in body), and
  `/api/review/*` (mine, modifications, acknowledge, dispute, resolve,
  messages, days, days/approve, days/unapprove).
- Everything stays in the hash-chained audit log, including removals (full
  before-state kept).

## 0.9.0 — manager dashboard & calendar

New **Manager → Dashboard & calendar** (lead+; pay figures manager+ only):

- **Overview** for a range (this/last week, this/last month, 30/90 days):
  hours worked, shifts, people, average shift, people on shift now,
  no-door-swipe / late / edited counts, labour cost.
- **Hours per day** — stacked by person (each person keeps a fixed colour),
  hover/focus for the day's breakdown, legend, and a table view.
- **When people are on site** — weekday × hour heatmap of person-hours.
- **Workers table** — sortable: hours, shifts / days, average shift, average
  start time, paid / unpaid break minutes, flags (no swipe, late vs roster,
  edited), cost.
- **Calendar** — month grid of who worked each day (hours, no-swipe warning);
  tap a day for its shifts and roster.
- **Timeline** — week view, a row per person: worked shifts as bars, rostered
  shifts as outlines, flagged clock-ins edged amber.
- **Activity** — recent clock-ins, edits, corrections, pay actions in plain
  English.
- `GET /api/manager/insights?from&to` returns the slice; all aggregation is
  client-side (`lib/insights.ts`, unit-tested) so every view agrees.
- Chart colours are a validated colour-blind-safe palette with light/dark
  variants; every coloured mark is name-labelled.
- Demo site: sample shifts now land in NZ working hours; dashboard works there.

## 0.8.1

- Pay screen picker lists active employees only (deactivated duplicates were showing).

## 0.8.0 — pay tracking: rates, paid / not paid, bonuses

- **Hourly rate per person** and a **Track pay** switch (*Admin → Employees*).
  Tracking is on by default; off removes the person from the Pay screen and
  refuses pay actions for them.
- **Manager → Pay** (manager+ only — leads don't see rates): pick a person and
  a range, see each entry's hours × rate, bonuses, what's owed, unpaid hours
  and what's been paid. Tick entries/bonuses and **Mark paid** / **Mark
  unpaid**, with an optional note (e.g. the bank reference).
- **Paid time is settled.** Marking an entry paid snapshots the rate and
  amount, so a later rate change never rewrites what was paid. Staff can no
  longer edit a paid entry (`423 entry_paid`, shown as locked); managers still
  can. Entries show a *Paid* badge in My hours and Edit entries.
- **Bonuses**: amount, date, reason. Never deleted — a wrong one is voided
  with a reason (the app's DB role has no DELETE on `bonuses`). Paid bonuses
  can't be voided.
- Every pay action (`mark_paid`, `mark_unpaid`, bonus `create` / `void`) is
  in the hash-chained audit log.
- Amounts are straight time (hours × rate). Overtime / stat-holiday multipliers
  from the pay-period timesheet are not applied to these figures.
- Staff edit window now also accepts future-dated times through to the edit,
  so they get `clock_in_in_future` rather than a misleading "locked".
- Migration `0012`: `employees.hourly_rate_cents`, `employees.pay_tracking`,
  `time_entries.paid_*`, `bonuses` table.

## 0.7.0 — shift accuracy, manager edits, door-access flag, email

- **Double-tap guard.** A clock-in within 60 s of a clock-out is refused
  (`409 just_clocked_out`, friendly kiosk message). The clock-out button turns
  into clock-in in the same spot, so a second tap used to open a phantom shift
  that ran until the 14 h auto clock-out. Offline-queued replays are exempt.
- **Fix a shift you're still clocked into.** *Fix times* now shows on open
  shifts: staff can correct their start time while clocked in.
- **Edit breaks.** The edit dialog lists the shift's breaks — change start,
  end and paid/unpaid, or add a missed break (`POST /entries/:id/breaks`,
  `PATCH /entries/:id/breaks/:breakId`). Breaks must sit inside the shift.
  Same day-after window, reason and audit rules as time edits.
- **Managers edit directly.** Leads and above can edit anyone's entry and
  breaks at any time (pay-period locks still apply), audited as
  `manager_edit`. New *Manager → Edit entries* screen: pick a person, see the
  last 14 days with flags, edit.
- **No-door-access flag.** Map each employee's HA card-reader entities
  (*Admin → Employees*). A clock-in — or an edited start time — with no swipe
  in the 3 h before (15 min grace after) is flagged `no_door_access` and
  triggers an alert. Tunable under settings `doorAccess`. HA unreachable =
  no flag (logged), never a blocked punch.
- **Email alerts via Microsoft Graph.** New optional add-on options
  `email_tenant_id`, `email_client_id`, `email_client_secret`, `email_from`,
  `email_to` (app registration with `Mail.Send`). Alerts (auto clock-out,
  no-door-access) go to every enabled channel; `POST /api/admin/notify/test`
  sends a test.
- Times can't be edited into the future. Migration `0011` adds
  `employees.access_entities`.

## 0.6.3 — self-edits lock after the day after

- **Staff can fix their own times on the shift's day and the day after**
  (facility timezone), then the entry locks. A self-edit outside that window —
  or one that moves a shift's clock-in into a locked day — is refused with
  `423 edit_window_closed`, and nothing is written.
- Locked entries open the My hours dialog as a correction request (a manager
  approves before times change), with a "Locked" note instead of the toggle.
- Every edit, refused or approved, still sits in the append-only hash-chained
  audit log; nothing can delete it.

## 0.6.2 — optional direct LAN port

- **Staff phones can clock in over site WiFi without an HA account.** The
  add-on now declares `8099/tcp` as an optional host port (disabled by
  default). Map it under the add-on's Network section and staff open
  `http://<ha-ip>:<port>/` — the proxy already served the app at the root when
  no ingress header is present. Identity headers are still stripped from
  non-Supervisor sources, so direct visitors get the PIN kiosk, not HA SSO.

## 0.6.1 — paid/unpaid break choice + Jobs admin (feedback round 4, Ben)

- **Break type is the employee's choice now.** The clock screen's single
  "Start break" (which silently recorded every break as unpaid) is replaced by
  two buttons: **Rest break (paid)** and **Meal break (unpaid)** — matching the
  NZ break semantics the compliance engine already used. Until now the UI could
  only record unpaid breaks, so every 2h+ shift was flagged
  `missing_rest_break` on manager timesheets; paid rest breaks fix that (and
  are not deducted from worked time).
- **Admin → Jobs.** The jobs API existed since 0.1.0 but had no UI, so the
  clock screen's switch-job menu (which only renders when jobs exist) was
  unreachable. New Jobs page: add jobs (name + optional costing code), edit,
  activate/deactivate. Once at least one job exists, employees get the job
  picker on clock-in and the **switch job** menu while clocked in — switching
  closes the current entry and opens a new one on the new job, both audited.
- All new strings translated in the five language packs; new paid-break
  integration test.

## 0.6.0 — native HA theming, live demo, HA profile pictures

Three feature areas so the add-on looks and feels like part of Home Assistant,
plus a fix for the remaining in-panel navigation 404.

- **Fix "back to Home" 404 inside the HA panel.** Next emitted the app root link
  as a BARE `/ha-ingress` (basePath root has no trailing slash), which the proxy
  rewrote to a bare-token URL `/api/hassio_ingress/<token>` — and HA-core's
  ingress route does NOT match a bare token (it 404s before auth; only
  `/<token>/` and `/<token>/<path>` match), so any full-page nav to Home 404'd.
  Fixed with `trailingSlash: true` + `skipTrailingSlashRedirect: true` in
  `next.config.ts` (root URLs now end in `/<token>/`, and the API — whose
  fetches are built without trailing slashes — is served without a 308) and by
  mapping the ingress-root `/` to `SENTINEL + "/"` in `proxy.js`. Verified
  against a live standalone+proxy: root, `/pin/`, `/admin/employees/` and their
  RSC payloads carry only slashed token URLs; `/api/health` GET and a
  `/api/auth/pin-login` POST return normally with zero redirects.

- **Native Home Assistant theming.** The whole app is now themed with Home
  Assistant's own design tokens (colours lifted verbatim from
  `home-assistant/frontend` — HA blue, card/background/text/divider colours,
  12px card radius, the Roboto/Noto font stack), mapped onto the shadcn/ui
  layer so every screen — kiosk, clock, my-hours, manager, admin, roster,
  leave, settings — picks it up. Adds a **dark / light / system** toggle and an
  **accent-colour picker** (the standard HA theme-picker palette), discoverable
  on the Home launcher and in Admin → Settings → Appearance. Choices persist per
  device (localStorage) and are applied before first paint (no theme flash);
  first run follows the OS `prefers-color-scheme`. Default is dark + HA blue
  (`#03a9f4`), matching the previous look. The fixed bottom nav is unchanged —
  only restyled.
- **Live demo on GitHub Pages** (https://jaketherabbit.github.io/ha-timeclock/).
  A `NEXT_PUBLIC_DEMO=1` build swaps the API layer for an in-browser fixture
  backend (seeded staff, several weeks of punches, breaks, corrections, leave,
  rosters, pay periods, timesheets, audit rows). Clock in/out, breaks, edits,
  approvals and roster changes mutate in-memory state so they visibly work
  within a session; a **page reload reseeds** (it is a static site, so state is
  not persisted). A "DEMO" banner marks it. The demo shim is client-only and
  tree-shaken out of the production standalone build; the add-on build is
  unchanged. Deployed by `.github/workflows/demo.yaml` (static export →
  `actions/deploy-pages`).
- **Profile pictures from Home Assistant.** Employee avatars are sourced from
  HA `person` entities: the add-on reads person states via the Supervisor Core
  proxy and matches person → employee by the person's `user_id` against the
  employee's linked HA username (the same link SSO uses), falling back to a
  display-name match. Pictures are proxied server-side through
  `GET /api/avatars/:id` (the `SUPERVISOR_TOKEN` never reaches the browser) and
  cached briefly. Avatars show on the kiosk staff grid, the manager live board,
  the employees admin list, and the session header, with a coloured **initials
  fallback** whenever a person has no picture (or outside HA). Requires that the
  HA person has a picture configured and is linked to the employee's HA
  username; unmatched staff simply show initials.
- Tests: added avatar matching/fallback unit tests and a real-Postgres avatar
  route integration suite (Supervisor mocked). i18n parity kept across all five
  language packs (new Appearance strings translated).

## 0.5.1 — sidebar for all users + fix back-navigation 404s

- `panel_admin: false`: the sidebar panel now shows for non-admin HA users
  (staff). HA's default hides ingress panels from everyone outside the admin
  group — staff couldn't see the Time Clock at all.
- Ingress proxy now rewrites `text/x-component` (Next.js RSC flight payloads).
  Client-side navigations were seeding router/history state with raw internal
  `/ha-ingress/*` URLs, so the in-app back button (e.g. Admin → back to Home)
  requested those paths against the HA host and 404'd.

## 0.5.0 — localization: countries, holidays, and language packs

Use it outside New Zealand without hand-editing config.

- **Country presets** (Admin -> Settings -> Region and language): New Zealand,
  USA, UK, Ireland, Canada, Australia, Germany, France, Switzerland, Sweden,
  Denmark. Picking a country sets week start, currency, date/number format,
  timezone, and a starting overtime rule. Every field stays editable.
- **Public holidays per country and region** via the `date-holidays` library
  (US state, German Bundesland, Swiss canton, UK nation, Canada province,
  Australia state). New Zealand keeps its own tuned engine (Matariki,
  Mondayisation, Auckland Anniversary) and its Holidays Act stat-pay — NZ
  behaviour is unchanged.
- **Locale-aware formatting** everywhere (dates, times, numbers, currency).
- **Language packs** for the employee-facing UI: English, German, French,
  Swedish, Danish. Set the language in Settings. Missing strings fall back to
  English, so the UI never blanks. The non-English translations are a starting
  point and should be checked by a native speaker before staff rely on them.
- Overtime and holiday presets are editable DEFAULTS, not legal advice. This
  add-on tracks hours and exports them; it does NOT calculate income tax
  (US federal/state, PAYE, Lohnsteuer, etc.) — that is your payroll system's job.

## 0.4.2 — dashboard card header fix + polished repo

- Card (v1.1.1): the header read the clocked-in count from a sensor attribute
  that never existed (the count is the entity state), so it showed "undefined
  clocked in". It now derives the count from the per-employee statuses, so the
  header is always correct. Found while producing the repo screenshots.
- Repo: README with screenshots and badges, MIT LICENSE, admin/manager and
  employee guides, CONTRIBUTING, SECURITY, and GitHub issue/PR templates. No
  functional add-on change beyond the card fix.

## 0.4.1 — make API-key rotation honest about HA reloads

- On the box, `rest_command.reload` can return 400 (e.g. a pre-existing
  rest_command elsewhere in a big facility config failing strict reload
  validation). It's harmless when rest_command content is unchanged, but on an
  API-key rotation a silent failure would leave HA sending the OLD key →
  punches 401 until an HA restart. The reload path now: (1) logs the HA
  response body so the cause is diagnosable, (2) returns per-service success,
  and (3) the "Rotate API key" action reports whether HA actually reloaded —
  the UI warns "restart HA once" if it didn't. No behavior change when reloads
  succeed. Still never `homeassistant.reload_all`.

## 0.4.0 — presence reminders (clock in/out when you arrive/leave)

Feedback round 3 (Ben): notify people to clock in when they join the work
Wi-Fi, and to clock out when they leave.

- **Presence reminders**: set a Notify service + Presence entity per employee
  (Admin → Employees, dropdowns discovered live from HA — device_tracker,
  person, connectivity binary_sensor, or a companion-app Wi-Fi SSID sensor),
  toggle on in Admin → Settings → Presence reminders. When someone arrives an
  actionable **"Clock in?"** notification lands on their phone; when they
  leave, **"Clock out?"**. One tap punches. Never auto-punches (staff keep
  control); arrive/depart grace periods absorb Wi-Fi flapping; a cold start
  never fires a burst of notifications.
- Runs **inside the add-on** (polls HA, debounces, sends the notifications) —
  **no per-employee HA automations**, so roster changes never reload anything
  on the box.
- The only HA-side addition is one tiny **static** automation
  (`timeclock_notify_actions`) that turns a notification button tap into a
  punch. It lives in its own package file (`timeclock_automation.yaml`),
  separate from the roster scripts (`timeclock.yaml`) and the rest_command
  (`timeclock_handlers.yaml`), so `automation.reload` fires only on an add-on
  upgrade that revises the handler — never on roster edits or key rotation.
  Still never `homeassistant.reload_all`.
- Hardening: notify-service string is strictly validated before use, and
  employee display-name slug collisions no longer produce duplicate YAML keys.
- DB: employees gain nullable `notify_service` / `presence_entity`
  (migration 0010). 155 tests (new presence unit + integration suites).

## 0.3.0 — UI overhaul + stop disturbing the rest of Home Assistant

Feedback round 2 (Ben): "it's crashing HA", "navigation and UI suck",
"deactivate doesn't work".

- **No more facility-wide reloads**: the integration installer previously
  called `homeassistant.reload_all` after writing the package — on a box
  running production automations out of packages that restarted everything
  (looked like an HA crash). Now reloads only `rest_command` + `script`, and
  only when the generated file content actually changed.
- **Recorder-friendly sensors**: `sensor.timeclock_summary` is now slim
  (status + period totals; attribute-stable while idle so recorder dedupes);
  graph series + punches moved to `sensor.timeclock_history`, pushed only on
  punches + hourly. Card v1.1.0 reads both.
- **Complete UI rebuild** (shadcn/ui, dark, mobile-first): fixed bottom nav
  in thumb reach (Home / Clock / Hours, + Manager for leads, + Admin for
  admins), top bar with an in-app back button on every screen (never relies
  on the browser/app back button), Home is a role-aware launcher menu, big
  touch targets, tables collapse to cards on phones.
- **Every action now gives visible feedback** (toasts). "Deactivate didn't
  work" was a server-side success with an invisible error path on failure —
  it's now an optimistic toggle switch with rollback + error toast, covered
  by regression tests (deactivate hides from kiosk grid, reactivate
  restores, role changes audited).
- Employees admin: set PIN via dialog (no more window.prompt), HA username
  editable inline (SSO linking), clearer statuses.

## 0.2.1 — fix sensor push on small-ICU Node (Alpine)

- `nzDateOf`/pay-period date strings were built with locale `.format()`;
  Alpine Node ships English-only ICU so en-CA fell back to M/D/YYYY and
  every downstream parse failed ("Invalid time value" — ha-push dead, no
  sensors). Now assembled from `formatToParts` (locale-proof) and the image
  installs `icu-data-full` so human-facing en-NZ dates render correctly.

## 0.2.0 — HA SSO, dashboard card, Android widgets

Feedback round: clock in/out from anywhere, accounts that follow the
HA login, PINs that work on any computer.

- **HA SSO**: an employee whose *HA username* matches the HA account opening
  the panel is signed in automatically, on any device. Matches the opaque HA
  user id or the human username (case-insensitive). Sign-out suppresses SSO
  for 12 h / until the next PIN login so shared kiosks can switch users.
- **Fix "PIN doesn't work on another computer"**: device binding is now an
  opt-in antifraud setting (`kiosk.requireDeviceBinding`, default **off**) —
  the 403 `device_not_bound` no longer masquerades as a wrong PIN. The kiosk
  grid also lists staff without PINs (greyed out) instead of hiding them.
- **Sensors**: `sensor.timeclock_summary` (+ per-employee status and
  numeric-hours sensors) pushed on every punch and every 5 min.
- **Dashboard card** (`timeclock-card`): live status tiles with one-tap clock
  in/out, punch log, week/month/quarter/year totals, and graphs — stacked
  daily bars, 26-week trends, a punch map (every shift at its real time of
  day), year race.
- **Android companion widgets**: one-click integration install generates
  `script.timeclock_<name>_toggle` per employee (auto-regenerated when the
  roster changes) — add as an Actions widget to clock in/out from a phone.
- **External API**: key-authenticated `/api/ext/*` (punch/status/summary);
  punches run through the same audited path as kiosk punches.
- New: role-aware home screen; Admin → Settings → Integration panel
  (install/status/API key). Add-on now maps `homeassistant_config` (rw) to
  install the package + card.

## 0.1.3 — fix first-boot: seed the claimable Admin

- Fresh installs had an empty employees table, so "claim admin" returned 409
  (no_claimable_admin). migrate.sh now seeds one Admin employee idempotently
  after migrations.

## 0.1.2 — fix ingress 400s on API responses (stuck loading panel)

- The ingress proxy buffered chunked upstream responses and set
  Content-Length while still forwarding the upstream
  `Transfer-Encoding: chunked` header. Supervisor's aiohttp rightly rejects
  the illegal combination with 400 ("Content-Length can't be present with
  Transfer-Encoding"), so every dynamic API call failed and the panel hung on
  the loading splash (static HTML had explicit lengths and worked — which is
  why assets rendered but the app never came up).
- Proxy now strips all RFC 7230 hop-by-hop headers (transfer-encoding,
  connection, keep-alive, te, trailer, upgrade, proxy-*) before responding.

## 0.1.1 — fix Supervisor build

- `ARG BUILD_FROM` moved above the first `FROM` (global scope). Declared
  mid-file it was stage-scoped, so the runtime `FROM ${BUILD_FROM}` resolved
  blank and the on-box build failed ("base name should not be blank").
  Verified with a real `docker buildx build` using the Supervisor's exact
  invocation.

## 0.1.0 — P3–P12: feature-complete

- **P3 clock**: in/out, paid/unpaid breaks, auto-deduct meal break (settings-
  driven), job/project switching, live timer kiosk screen. Every punch audited.
- **P4 edits**: self-edit with mandatory reason (entry flagged `edited`
  forever), correction request → lead/manager approval workflow, my-hours view.
- **P5 rules**: NZ overtime engine (daily>8h / weekly>40h, configurable
  multipliers + optional 2x tier), computed NZ public holidays (Easter
  computus, Mondayisation pairs, Matariki table, Auckland Anniversary),
  stat-day time-and-a-half + alternative-holiday assessment, punch rounding
  (report-time only), ERA break-compliance flags, whole-app settings doc
  (zod-validated, audited).
- **P6 rostering**: shifts (NZ wall-clock, DST-correct), scheduled-vs-actual
  comparison, late / no-show / in-progress detection.
- **P7 leave**: request → approval, ledger-based balances, 4/52 annual-leave
  accrual engine (idempotent bookmark), manual adjustments.
- **P8 manager**: live who's-in board, pay-period materialization, timesheet
  engine (OT attribution, stat pay, compliance + edited flags), sign-off +
  LOCK (locked periods immutable; admin unlock requires reason), compliance
  audit viewer with live chain verification.
- **P9 reports**: day-level CSV, PDF summary (pdfkit), payroll adapter seam —
  CSV working, Xero/iPayroll stubbed (501 with guidance).
- **P10 notifications**: HA notify via Supervisor proxy, SMTP interface wired
  (creds deferred), auto-clockout safety net (cron 15min), daily pg_dump
  backup + pg_restore verify, weekly accrual cron.
- **P11 anti-fraud**: geofence (haversine, flag or enforce), IP/WiFi allowlist
  (CIDR), photo-on-punch (JPEG to /data/photos), device-bind + PIN from P2,
  punch forensics stored on entries.
- **P12 polish**: kiosk offline queue (localStorage replay, server honours
  bounded `clientQueuedAt` + flags `offline_queued`), i18n seam, dark kiosk
  theme, manager/roster/leave/settings UIs.
- Fix: pdfkit must be `serverExternalPackages` — bundling broke its font
  loading in the standalone build.

## 0.0.3 — P2 auth: sessions, RBAC, kiosk PIN + device binding

- Two identity planes: HA Ingress headers (`X-Remote-User-*`) identify the
  panel opener; employee PIN + bound device is the punch-authority. Provider
  seam (`AuthProvider`) keeps a future remote login a drop-in.
- DB-backed revocable sessions + HMAC-signed cookie; secret generated once to
  `/data/session_secret`.
- PIN auth: scrypt (no native deps), per-user salt, timing-safe compare, 5-fail
  60s rate limiter per employee+device.
- Device binding: raw token only in the kiosk cookie, sha256 in DB; admin
  "bind this device"; zero-devices bootstrap auto-binds the first kiosk.
- RBAC employee<lead<manager<admin, `requireRole` guard on /api/admin/*.
- First-boot bootstrap: first HA user claims the seeded Admin (409 afterwards).
- Ingress proxy strips X-Remote-User-*/X-Ingress-Path unless the request comes
  from the Supervisor source IP (172.30.32.2) or loopback — header spoofing
  from other containers is neutralized.
- UI: kiosk PIN pad (`/pin`), Admin → Employees (create, role, PIN, activate,
  device bind). All auth-relevant mutations audited; chain stays verified.
- Tests: 32 passing (unit pin/session/rbac/device + 11-step integration flow
  against real Postgres).

## 0.0.2 — P1 database + immutable audit

- Schema: `employees`, `time_entries` (mutable truth), `audit_log` (append-only)
  via idempotent SQL migrations, applied by `migrate.sh` as postgres on boot.
- **Audit triple-lock**: (1) runtime connects as `timeclock_app` with
  SELECT+INSERT only on `audit_log`; (2) triggers `RAISE EXCEPTION` on
  UPDATE/DELETE/TRUNCATE — superuser included; (3) SHA-256 hash-chain computed
  in a `BEFORE INSERT` trigger (advisory-lock serialized), `verify_audit_chain()`
  detects any out-of-band tamper.
- Drizzle ORM client + schema; append-only `appendAudit()` writer with
  canonical (sorted-key) payload serialization.
- Health route now pings Postgres (`db: up|down|skipped`).
- Tests: 12 passing, incl. real-Postgres proof that raw-psql UPDATE/DELETE/
  TRUNCATE all fail and that chain verification catches tampering. CI runs the
  proof against a postgres:16 service.

## 0.0.1 — P0 scaffold

- Add-on packaging: `config.yaml`, `build.yaml`, `Dockerfile`, s6-overlay v3
  service tree (`prepare → postgres → migrate → timeclock → ingress`).
- Bundled PostgreSQL 16 on `/data/postgres` (loopback only, `initdb` on first
  boot).
- Ingress reverse-proxy (`proxy.js`) that rewrites the `/ha-ingress` sentinel to
  HA's real `X-Ingress-Path` — Next.js assets resolve inside the ingress iframe.
- Next.js 15 App Router app with Hono API; `GET api/health` returns JSON.
- Blank P0 panel loads in the HA sidebar.
