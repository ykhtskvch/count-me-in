import assert from "node:assert/strict";
import test from "node:test";
import { deleteAccount, updateSettings } from "../db/account.ts";
import { setInterest } from "../db/activities.ts";
import { hideCard, publishCard, rejectCard, reviewQueue, suggestCard } from "../db/cards.ts";
import { completeGatherings, getGathering, respondHostOffer } from "../db/gatherings.ts";
import { sendDueEmails } from "../db/mailer.ts";
import { computeMetrics } from "../db/metrics.ts";
import { blockPerson, createReport, hostOf, openReports, resolveReports } from "../db/reports.ts";
import type { OutgoingEmail } from "../db/ses.ts";
import { normalizeCard } from "../lib/card-input.ts";
import { cardState, hours, outbox, tokenFor, wonGathering } from "./helpers/fixtures.ts";

const card = { title: "Sock darning", outcome: "Everyone mends one sock", minPeople: 3, maxPeople: 8, durationHours: 1.5, placeKind: "venue", bring: "A holey sock" };

test("card input: required fields, sensible numbers, money in pounds", () => {
  const good = normalizeCard({ ...card, materialsCost: "2.50" });
  assert.ok(good.ok);
  assert.equal(good.card.durationMin, 90);
  assert.equal(good.card.materialsCostPence, 250);
  const bad = normalizeCard({ title: "x", minPeople: 1, maxPeople: 0, durationHours: 20, placeKind: "home" });
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.fields).sort(), ["durationHours", "maxPeople", "minPeople", "outcome", "placeKind", "title"]);
});

test("a participant's card waits for review; publishing tells the author; a moderator's goes straight in", async () => {
  const { db } = await wonGathering();
  const input = normalizeCard(card);
  assert.ok(input.ok);
  const id = await suggestCard(db, { id: "p4", role: "participant" }, input.card);
  assert.deepEqual((await reviewQueue(db)).map((c) => c.id), [id]);
  assert.equal((await reviewQueue(db))[0].authorName, "Person 4");

  const edited = normalizeCard({ ...card, title: "Darning socks" });
  assert.ok(edited.ok);
  assert.equal(await publishCard(db, "p6", id, edited.card), true);
  const row = await db.prepare("SELECT title, state FROM activity WHERE id = ?1").bind(id).first<{ title: string; state: string }>();
  assert.deepEqual({ ...row }, { title: "Darning socks", state: "in_catalogue" });
  assert.equal((await outbox(db, "card_published"))[0].personId, "p4");
  assert.equal(await publishCard(db, "p6", id), false);

  const starter = await suggestCard(db, { id: "p6", role: "moderator" }, input.card);
  const s = await db.prepare("SELECT state FROM activity WHERE id = ?1").bind(starter).first<{ state: string }>();
  assert.equal(s!.state, "in_catalogue");
});

test("rejecting gives the author one of the set reasons", async () => {
  const { db } = await wonGathering();
  const input = normalizeCard(card);
  assert.ok(input.ok);
  const id = await suggestCard(db, { id: "p4", role: "participant" }, input.card);
  assert.equal(await rejectCard(db, "p6", id, "home"), true);
  const mail: OutgoingEmail[] = [];
  await sendDueEmails(db, { siteUrl: "https://example.org", lookupEmail: async (x) => `${x}@example.org`, send: async (m) => (mail.push(m), "x") }, hours(1));
  const rejected = mail.find((m) => m.to === "p4@example.org")!;
  assert.match(rejected.subject, /wasn’t published/);
  assert.match(rejected.text, /someone’s home/);
  assert.match(rejected.text, /https:\/\/example\.org\/settings/);
  const log = await db.prepare("SELECT action, reason FROM mod_action WHERE action = 'reject_card'").first<{ action: string; reason: string }>();
  assert.equal(log!.reason, "home");
});

test("hiding a card cancels its gathering and takes it out of the catalogue", async () => {
  const { db, gatheringId } = await wonGathering();
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal(await hideCard(db, "p6", "a1", "Not safe"), true);
  assert.equal(await cardState(db), "removed");
  const g = await db.prepare("SELECT status FROM gathering WHERE id = ?1").bind(gatheringId).first<{ status: string }>();
  assert.equal(g!.status, "cancelled");
  assert.equal((await outbox(db, "gathering_cancelled")).length, 3);
});

test("reports: one button, grouped for the moderator, only the host can be reported as a person", async () => {
  const { db, gatheringId } = await wonGathering({ voters: 4 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal(await hostOf(db, gatheringId, "p2"), "p1");
  assert.equal(await hostOf(db, gatheringId, "p5"), null); // not going
  assert.equal(await hostOf(db, gatheringId, "p1"), null); // yourself

  await createReport(db, "p2", { kind: "person", id: "p1" }, "Rude");
  await createReport(db, "p2", { kind: "person", id: "p1" }, "Rude, and late");
  await createReport(db, "p3", { kind: "person", id: "p1" }, "");
  await createReport(db, "p3", { kind: "activity", id: "a1" }, "Odd card");
  const reports = await openReports(db);
  assert.equal(reports[0].label, "Person 1");
  assert.equal(reports[0].count, 2);
  assert.deepEqual(reports[0].notes, ["Rude, and late"]);

  await resolveReports(db, "p6", { kind: "activity", id: "a1" }, "dismiss", null);
  assert.equal((await openReports(db)).length, 1);
});

test("blocking signs the person out, takes them off the gathering and hosting passes on", async () => {
  const { db, gatheringId } = await wonGathering({ voters: 4 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  await db.prepare("INSERT INTO session (token_hash, auth_user_id, expires_at) VALUES ('t', 'p1', '2099-01-01')").run();
  await createReport(db, "p2", { kind: "person", id: "p1" }, "Threatening");
  assert.equal(await resolveReports(db, "p6", { kind: "person", id: "p1" }, "block", "Threats", hours(2)), true);
  const p = await db.prepare("SELECT blocked_at AS b FROM person WHERE id = 'p1'").first<{ b: string | null }>();
  assert.ok(p!.b);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM session").first<{ n: number }>())!.n, 0);
  const g = (await getGathering(db, gatheringId, "p2"))!;
  assert.equal(g.going, 2);
  assert.equal(g.hasHost, false);
  assert.deepEqual((await outbox(db, "host_offer")).map((o) => o.personId), ["p1", "p2"]);
  assert.equal((await openReports(db)).length, 0);
});

test("moderators can't be blocked", async () => {
  const { db } = await wonGathering();
  await db.prepare("UPDATE person SET role = 'moderator' WHERE id = 'p6'").run();
  assert.equal(await blockPerson(db, "p6", "p6", null), false);
});

test("deleting an account removes the person and their traces, and their gathering carries on", async () => {
  const { db, gatheringId } = await wonGathering({ voters: 4 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  await updateSettings(db, "p1", { showName: true });
  const deleted = await deleteAccount(db, "p1", hours(2));
  assert.deepEqual(deleted, { authUserId: "p1" });
  for (const table of ["person", "interest", "slot_vote", "attendance", "host_offer", "email_outbox"]) {
    const col = table === "person" ? "id" : "person_id";
    const n = await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} = 'p1'`).first<{ n: number }>();
    assert.equal(n!.n, 0, table);
  }
  const g = (await getGathering(db, gatheringId, "p2"))!;
  assert.equal(g.going, 2);
  assert.equal(g.status, "awaiting_place");
});

test("metrics count what happened", async () => {
  const { db, gatheringId } = await wonGathering({ min: 2, voters: 3 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  const g = (await getGathering(db, gatheringId, null))!;
  await completeGatherings(db, new Date(Date.parse(g.endsAt) + 1000));
  const input = normalizeCard(card);
  assert.ok(input.ok);
  await suggestCard(db, { id: "p4", role: "participant" }, input.card);
  await setInterest(db, "a1", "p5", []);
  const m = await computeMetrics(db);
  assert.equal(m.gatheringsHappened, 1);
  assert.deepEqual(m.cardsReachedMinimum, { reached: 1, published: 1 });
  assert.deepEqual(m.roundsWon, { won: 1, closed: 1 });
  assert.equal(m.cardsSuggestedByParticipants, 1);
  assert.equal(m.happenedWithoutModerator, 1);
  assert.equal(m.peopleCameBack, 0);
});
