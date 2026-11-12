# Employee guide

How to clock in and out. Short version: tap your name, enter your PIN, hit the
big button.

## Clocking in and out

You have three ways to do it. Use whichever is in front of you.

**On the wall tablet (kiosk).**
1. Tap your name on the grid.
2. Enter your PIN.
3. Tap the big Clock in button. Tap Clock out at the end.

If your name is greyed out and says "No PIN set", ask your admin to set your PIN.

**From Home Assistant.**
Open the Time Clock panel in the sidebar. If your Home Assistant login is linked
to your staff record, you are already signed in. Hit Clock in.

**From your phone.**
If your admin set up the widget, add a Home Assistant companion-app widget to
your home screen and tap it to clock in or out. If presence reminders are on, you
will get a "Clock in?" notification when you get to work and a "Clock out?" one
when you leave. Tap the button on the notification. It never clocks you in or out
by itself. You always tap.

## Breaks

While you are clocked in you can start and end a break. Unpaid breaks come off
your worked time. If you work a long shift and never take a break, the system
deducts a standard meal break at clock-out so the timesheet is honest. You will
see it listed, it is not hidden.

## Switching jobs

If your site tracks jobs, use Switch job to move to a different job without
clocking out. It closes the current entry and opens a new one on the new job.

## Your hours

My hours shows your hours one day at a time. Each day shows each start and
finish, the breaks, and the worked total. A day has one of these labels:

- **You can edit** — you can change this day.
- **Approved** — your manager approved this day. You cannot change it.

Anything that was edited is marked.

## Fixing your times

You can change all of your days until your manager approves them. You do not
need approval to make a change.

1. Open **My hours**.
2. Select the range (Today, Week, Fortnight or Month).
3. Do one of these steps:
   - To change a start or finish time, push **Fix times** on the entry.
   - To add or remove a break, push **Fix times**, then push **Add break** or
     **Remove break**.
   - If you left site and came back, push **Add start/finish** on that day. Each
     start and finish is a separate entry.
   - If you forgot to clock in for all of a day, push **Add missed time**. Set
     the date and times.
   - To remove an entry, push the bin icon on the entry.
4. Write a reason. A reason is mandatory.
5. Push **Save**.

Your manager sees each change and your reason. If your manager does not agree,
you see **Your manager has a question** at the top of My hours. Read the
message, write an answer and push **Send**.

When your manager approves a day, you cannot change it again. If an approved day
is wrong, open the entry and send a correction. Your manager must approve it.

All changes are recorded in the audit log with your reason. Do not worry about
"messing up the history". Just say what happened.

## Leave

Leave shows your balances and lets you request time off. Your manager approves or
declines it and you will see the result.

## If something is not working

- Wrong PIN message on a tablet that used to work: the device might not be a
  registered kiosk. Tell your admin.
- You are not signed in when you open the panel: your Home Assistant login is not
  linked to your staff record yet. Ask your admin to add your HA username.
- The phone notification did not arrive: if you left the site with no mobile
  signal it will turn up when you are back online. Clock out from the tablet or
  the panel if you need to.
