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
| `db/outbox.ts`, `drizzle/0002_outbox.sql` | Emails are queued in the same transaction as the change they report; sending comes with epic 7 | 7 |
| `app/page.tsx`, `app/activity/[id]/` | Catalogue and the activity page with Count me in / I'm out | 2.1–2.3, 3.1–3.3 |

## Hosting

`.openai/hosting.json` binds D1 as `DB`. It has no `project_id` yet: Count Me
In needs its own Sites project and its own D1 database, separate from the
noticeboard's.
