import assert from "node:assert/strict";
import test from "node:test";
import { respondHostOffer } from "../db/gatherings.ts";
import { MAX_ATTEMPTS, queueReminders, sendDueEmails } from "../db/mailer.ts";
import type { OutgoingEmail } from "../db/ses.ts";
import { hours, tokenFor, wonGathering } from "./helpers/fixtures.ts";

function fakeMail(fail = false) {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    deps: {
      siteUrl: "https://example.org/",
      lookupEmail: async (authUserId: string) => `${authUserId}@example.org`,
      send: async (message: OutgoingEmail) => {
        if (fail) throw new Error("SES is down");
        sent.push(message);
        return "msg";
      },
    },
  };
}

test("queued emails are sent once each, and one-time tokens are cleared after sending", async () => {
  const { db } = await wonGathering();
  const mail = fakeMail();
  const first = await sendDueEmails(db, mail.deps, hours(0.1));
  // Three "pick evenings" were queued when the round opened, but it is already won: dropped.
  assert.deepEqual(first, { sent: 1, dropped: 3, failed: 0 });
  assert.equal(mail.sent[0].to, "p1@example.org");
  assert.match(mail.sent[0].subject, /Would you greet everyone/);
  assert.deepEqual(await sendDueEmails(db, mail.deps, hours(0.2)), { sent: 0, dropped: 0, failed: 0 });
  const leftover = await db.prepare("SELECT count(*) AS n FROM email_outbox WHERE payload LIKE '%token%'").first<{ n: number }>();
  assert.equal(leftover!.n, 0);
});

test("an answered offer is not emailed late", async () => {
  const { db } = await wonGathering();
  await respondHostOffer(db, await tokenFor(db, "p1"), false, hours(1));
  const mail = fakeMail();
  await sendDueEmails(db, mail.deps, hours(1));
  assert.deepEqual(mail.sent.map((m) => m.to), ["p2@example.org"]);
});

test("a failing provider is retried, then given up after the limit", async () => {
  const { db } = await wonGathering();
  const broken = fakeMail(true);
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await sendDueEmails(db, broken.deps, hours(0.1));
  const row = await db
    .prepare("SELECT attempts, last_error AS lastError, sent_at AS sentAt FROM email_outbox WHERE template = 'host_offer'")
    .first<{ attempts: number; lastError: string; sentAt: string | null }>();
  assert.equal(row!.attempts, MAX_ATTEMPTS);
  assert.equal(row!.lastError, "SES is down");
  assert.equal(row!.sentAt, null);
});

test("the booked email and the day-before reminder go to everyone going, once", async () => {
  const { db } = await wonGathering();
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  const mail = fakeMail();
  await sendDueEmails(db, mail.deps, hours(1));
  const booked = mail.sent.filter((m) => /is on:/.test(m.subject));
  assert.equal(booked.length, 3);
  assert.ok(booked.every((m) => /Host: Person 1/.test(m.text)));

  const start = await db.prepare("SELECT starts_at AS s FROM slot WHERE status = 'won'").first<{ s: string }>();
  const dayBefore = new Date(Date.parse(start!.s) - 20 * 3600000);
  assert.equal(await queueReminders(db, dayBefore), 1);
  assert.equal(await queueReminders(db, dayBefore), 0);
  await sendDueEmails(db, mail.deps, dayBefore);
  assert.equal(mail.sent.filter((m) => m.subject.startsWith("Tomorrow:")).length, 3);
});
