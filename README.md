# Count Me In

One-off evenings with people who live nearby, for adults. There is no organiser:
an activity card collects interest, and once it reaches its minimum number of
people the platform suggests a few evenings and a checked public place.

Working name. Non-profit: no fees, no ads, no profiles, ratings or feed.

## Stack

The same as the Street Noticeboard, so the two can share know-how and, if
decided, sign-in:

- TypeScript, React and Next.js through [vinext](https://www.npmjs.com/package/vinext), on Cloudflare Workers (Sites hosting);
- Cloudflare D1 (SQLite) through Drizzle ORM; migrations live in `drizzle/`;
- Supabase Auth for magic-link sign-in; the email address stays in Supabase, never in D1;
- Supabase Cron calls a site handler for timed jobs;
- Amazon SES for email, with delivery events through SNS.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

## Checks

```bash
npm run test:unit   # card lifecycle and other pure logic (node --test, no build)
npm test            # unit tests, then a production build and a rendered-HTML smoke test
npm run check       # TypeScript
npm run lint
```

Database tests (`tests/rounds.test.ts`) run the real migrations on Node's built-in SQLite through a small D1 stand-in in `tests/helpers/d1.ts`.

After changing `db/schema.ts`, run `npm run db:generate` to write a new migration.

## What is here

| Path | What it holds | Backlog item |
| --- | --- | --- |
| `db/schema.ts`, `drizzle/0000_init.sql` | Data model: 18 tables (15 for the product, 3 for sign-in), plus the email outbox; the database itself refuses two gatherings from one round and a scheduled gathering without a place or host | 0.2 |
| `lib/card-state.ts` | Card lifecycle and the only allowed transitions | 0.3 |
| `lib/settings.ts` | Default timings and limits; values the PRD does not give are marked as assumptions | 0.7 |
| `lib/catalogue.ts`, `db/activities.ts` | Catalogue order, "still needed" counter, rough times; interest is accepted only while a card is in the catalogue or choosing | 2.1–2.3, 3.1–3.3 |
| `lib/slots.ts`, `db/rounds.ts` | Picking evenings: slot proposal (London time, venue windows), first slot to reach the minimum wins, picking closes 3 days before the first slot | 4.1–4.4 |
| `db/gatherings.ts`, `app/gathering/[id]/`, `app/host/` | The gathering and its host: hosting offered earliest-first with a 24-hour reply, public place from the moderator's list, join until full, leave any time, below-minimum notice, cancel, happened | 6.1–6.5 |
| `db/outbox.ts`, `drizzle/0002_outbox.sql` | Emails are queued in the same transaction as the change they report | 7 |
| `lib/emails.ts`, `db/mailer.ts`, `db/ses.ts` | Email texts; sending through Amazon SES with the address looked up in Supabase at send time; stale emails are dropped, failures retried 5 times | 7 |
| `lib/scheduler.ts`, `app/api/internal/tick/`, `ops/supabase/scheduler.sql` | Signed Supabase Cron call every 5 minutes: closes rounds, passes on unanswered host offers, cancels unready gatherings, marks happened ones, queues reminders, sends email | 0.4 |
| `db/venues.ts`, `app/venue/` | Indoor venues: room request by email in the platform's name, answered by button without an account; decline or 48 hours of silence moves to the next venue; none left cancels and tells the group; a standing window that approves itself books at once and notifies the venue | 5.2–5.4 |
| `lib/card-input.ts`, `db/cards.ts`, `app/suggest/` | Anyone suggests an activity; the moderator publishes (with corrections) or rejects with a set reason, and the author is emailed; a moderator's own card goes straight in (the starter set); hiding a card cancels its gathering | CAT-03, CAT-05, MOD-01, MOD-02, MOD-04 |
| `db/reports.ts`, `app/components/report-button.tsx` | One-button reports on an activity or a gathering's host, seen only by moderators; dismiss, hide or block, which signs the person out and takes them off gatherings | MOD-03, MOD-04 |
| `db/account.ts`, `app/settings/` | Settings linked from every email; whether others going may see your name; deleting the account and its sign-in | NTF-03, INT-03, ACC-04 |
| `db/metrics.ts` | The PRD's seven metrics on `/moderate`, counted from stored data only | 10 |
| `db/followups.ts`, `app/after/`, `drizzle/0003_followup.sql` | The morning after a gathering: one email with two questions, answered from the link; "again" counts the person back in | GAT-07 |
| `app/components/share-link.tsx` | Invite a friend with the activity's link | CAT-07 |
| `lib/catalogue.ts` (`isStale`) | A card nobody has shown interest in for 30 days is not removed, it sinks below the others | CAT-06 |
| `lib/card-input.ts`, `db/rounds.ts`, `drizzle/0004_fixed_date.sql` | The proposer may set a date and start time (7 to 90 days ahead); it becomes the only evening offered and the minimum still applies; if the date gets too close, the platform offers its own evenings | TIME-06 |
| `db/digest.ts`, `drizzle/0005_published_at.sql` | Weekly email about new activities: off unless switched on in `/settings`, Monday morning, at most once a week, only when there is something new for that person | NTF-04 |
| `lib/place-input.ts`, `db/places.ts`, `app/moderate/` | Moderator screen: the list of places with standing windows, and live gatherings with a cancel button (reason kept in the log) | 5.1, 8.4 |
| `app/page.tsx`, `app/activity/[id]/` | Catalogue and the activity page with Count me in / I'm out | 2.1–2.3, 3.1–3.3 |

## Making someone a moderator

Sign in once and finish `/welcome`. Then find your user ID under Supabase → Authentication → Users and run this in the D1 console:

```sql
UPDATE person SET role = 'moderator' WHERE auth_user_id = '<your Supabase user ID>';
```

The moderator screen is at `/moderate`.

## Turning on the clock and email

1. In the Supabase SQL editor, run `ops/supabase/scheduler.sql` after putting the site address in it.
2. Copy the generated key into the site's `SCHEDULER_SECRET` (the script says how).
3. Add the SES keys and `SES_FROM_EMAIL`. Emails keep waiting in `email_outbox` until `EMAIL_SENDING_ENABLED=true`.

## Hosting

`.openai/hosting.json` binds D1 as `DB`. It has no `project_id` yet: Count Me
In needs its own Sites project and its own D1 database, separate from the
noticeboard's.
