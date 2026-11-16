import assert from "node:assert/strict";
import test from "node:test";
import { updateSettings, wantsDigest } from "../db/account.ts";
import { getActivity, setInterest } from "../db/activities.ts";
import { publishCard, reviewQueue, suggestCard } from "../db/cards.ts";
import { queueDigests } from "../db/digest.ts";
import { sendDueEmails } from "../db/mailer.ts";
import { getOpenRound, openRoundIfReady } from "../db/rounds.ts";
import type { OutgoingEmail } from "../db/ses.ts";
import { normalizeCard } from "../lib/card-input.ts";
import { londonDateTime } from "../lib/slots.ts";
import { testDatabase } from "./helpers/d1.ts";
import { outbox } from "./helpers/fixtures.ts";

// A Monday, 10:00 in London.
const now = new Date("2026-11-16T10:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86400000);

const base = { title: "Mend a jumper", outcome: "One mended jumper each", minPeople: 2, maxPeople: 6, durationHours: 2, placeKind: "public" };

async function people(count: number, moderator = true) {
  const db = testDatabase();
  for (let n = 1; n <= count; n++) {
    await db
      .prepare(`INSERT INTO person (id, auth_user_id, display_name, postcode_district, adult_confirmed_at, rules_version, role)
        VALUES (?1, ?1, ?2, 'SE15', '2026-11-16', 'r1', ?3)`)
      .bind(`p${n}`, `Person ${n}`, moderator && n === 1 ? "moderator" : "participant")
      .run();
  }
  await db
    .prepare(`INSERT INTO place (id, name, address, postcode_district, kind, step_free)
      VALUES ('pl1', 'Peckham Rye bandstand', 'Peckham Rye Park', 'SE15', 'public', 1)`)
    .run();
  return db;
}

const card = (extra: Record<string, unknown> = {}) => {
  const result = normalizeCard({ ...base, ...extra }, now);
  assert.ok(result.ok);
  return result.card;
};

test("a set date needs both date and time, and must be 7 to 90 days away", () => {
  assert.equal(card().fixedStartsAt, null);
  assert.equal(card({ fixedDate: "2026-12-05", fixedTime: "14:00" }).fixedStartsAt, "2026-12-05T14:00:00.000Z");
  for (const bad of [{ fixedDate: "2026-12-05" }, { fixedTime: "14:00" }, { fixedDate: "2026-11-20", fixedTime: "14:00" }, { fixedDate: "2027-06-01", fixedTime: "14:00" }, { fixedDate: "soon", fixedTime: "14:00" }]) {
    const result = normalizeCard({ ...base, ...bad }, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fields.fixedDate);
  }
  // Summer time: 19:00 in London is 18:00 UTC.
  assert.deepEqual(londonDateTime("2026-07-01T18:00:00.000Z"), { date: "2026-07-01", time: "19:00" });
});

test("a card with a set date offers only that date, and the minimum still applies", async () => {
  const db = await people(3);
  const id = await suggestCard(db, { id: "p1", role: "moderator" }, card({ fixedDate: "2026-12-05", fixedTime: "14:00" }), now);
  assert.equal((await getActivity(db, id, { district: null, personId: null }, now))!.fixedStartsAt, "2026-12-05T14:00:00.000Z");
  await setInterest(db, id, "p2", []);
  assert.equal(await openRoundIfReady(db, id, now), null); // one person is below the minimum of two
  await setInterest(db, id, "p3", []);
  assert.ok(await openRoundIfReady(db, id, now));
  const round = (await getOpenRound(db, id, null))!;
  assert.deepEqual(round.slots.map((s) => [s.startsAt, s.endsAt]), [["2026-12-05T14:00:00.000Z", "2026-12-05T16:00:00.000Z"]]);
});

test("when the set date is too close, the platform offers its own evenings", async () => {
  const db = await people(3);
  const id = await suggestCard(db, { id: "p1", role: "moderator" }, card({ fixedDate: "2026-11-24", fixedTime: "19:00" }), now);
  const later = days(6); // two days before the set date
  assert.equal((await getActivity(db, id, { district: null, personId: null }, later))!.fixedStartsAt, null);
  await setInterest(db, id, "p2", []);
  await setInterest(db, id, "p3", []);
  assert.ok(await openRoundIfReady(db, id, later));
  const round = (await getOpenRound(db, id, null))!;
  assert.ok(round.slots.length > 1);
  assert.ok(round.slots.every((s) => s.startsAt > days(12).toISOString()));
});

test("the moderator sees the set date in the review queue and can change it", async () => {
  const db = await people(2);
  const id = await suggestCard(db, { id: "p2", role: "participant" }, card({ fixedDate: "2026-12-05", fixedTime: "14:00" }), now);
  assert.equal((await reviewQueue(db))[0].fixedStartsAt, "2026-12-05T14:00:00.000Z");
  assert.ok(await publishCard(db, "p1", id, card(), now));
  assert.equal((await getActivity(db, id, { district: null, personId: null }, now))!.fixedStartsAt, null);
});

async function send(db: D1Database, at: Date) {
  const sent: OutgoingEmail[] = [];
  const tally = await sendDueEmails(db, { siteUrl: "https://example.org", lookupEmail: async (id) => `${id}@example.org`, send: async (m) => { sent.push(m); return "id"; } }, at);
  return { sent, tally };
}

test("the weekly email is off by default and goes only to people who asked", async () => {
  const db = await people(3);
  assert.equal(await wantsDigest(db, "p2"), false);
  await updateSettings(db, "p2", { digest: true });
  assert.equal(await wantsDigest(db, "p2"), true);
  const id = await suggestCard(db, { id: "p1", role: "moderator" }, card(), days(-2));
  assert.equal(await queueDigests(db, now), 1);
  assert.deepEqual((await outbox(db, "digest")).map((r) => r.personId), ["p2"]);
  const { sent } = await send(db, now);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "p2@example.org");
  assert.equal(sent[0].subject, "New this week: Mend a jumper");
  assert.match(sent[0].text, new RegExp(`- Mend a jumper\\. One mended jumper each: https://example\\.org/activity/${id}`));
  assert.match(sent[0].text, /https:\/\/example\.org\/settings/);
  assert.match(sent[0].html, new RegExp(`<a href="https://example\\.org/activity/${id}">`));
});

test("the weekly email comes at most once a week, on Monday morning, and only with something new", async () => {
  const db = await people(3);
  await updateSettings(db, "p2", { digest: true });
  assert.equal(await queueDigests(db, now), 0); // nothing new
  await suggestCard(db, { id: "p1", role: "moderator" }, card(), days(-2));
  assert.equal(await queueDigests(db, new Date("2026-11-16T06:00:00Z")), 0); // too early
  assert.equal(await queueDigests(db, new Date("2026-11-17T10:00:00Z")), 0); // Tuesday
  assert.equal(await queueDigests(db, now), 1);
  assert.equal(await queueDigests(db, new Date(now.getTime() + 5 * 60000)), 0); // the next run
  await suggestCard(db, { id: "p1", role: "moderator" }, card({ title: "Board games" }), days(3));
  assert.equal(await queueDigests(db, days(7)), 1); // next Monday
  assert.equal((await outbox(db, "digest")).length, 2);
  const { sent } = await send(db, days(7));
  assert.equal(sent.at(-1)!.subject, "New this week: Board games"); // last week's card is not repeated
});

test("the weekly email leaves out your own cards and ones you are already in, and is dropped if nothing is left", async () => {
  const db = await people(3, false);
  await updateSettings(db, "p2", { digest: true });
  await updateSettings(db, "p3", { digest: true });
  const id = await suggestCard(db, { id: "p2", role: "participant" }, card(), days(-3));
  await publishCard(db, "p1", id, null, days(-2));
  assert.equal(await queueDigests(db, now), 1); // p3 only: p2 suggested it
  assert.deepEqual((await outbox(db, "digest")).map((r) => r.personId), ["p3"]);
  await setInterest(db, id, "p3", []); // counted in before the email went
  const { sent, tally } = await send(db, now);
  assert.equal(sent.filter((m) => m.subject.startsWith("New this week")).length, 0);
  assert.ok(tally.dropped >= 1);
});

test("switching the weekly email off stops one already queued", async () => {
  const db = await people(3);
  await updateSettings(db, "p2", { digest: true, showName: true });
  await suggestCard(db, { id: "p1", role: "moderator" }, card(), days(-1));
  assert.equal(await queueDigests(db, now), 1);
  await updateSettings(db, "p2", { digest: false });
  assert.equal((await send(db, now)).sent.length, 0);
  const row = await db.prepare("SELECT show_name AS showName FROM person WHERE id = 'p2'").first<{ showName: number }>();
  assert.equal(row!.showName, 1);
});
