import assert from "node:assert/strict";
import test from "node:test";
import { setInterest } from "../db/activities.ts";
import {
  cancelGathering,
  cancelUnreadyGatherings,
  completeGatherings,
  expireHostOffers,
  getGathering,
  joinGathering,
  leaveGathering,
  respondHostOffer,
} from "../db/gatherings.ts";
import { getOpenRound, openRoundIfReady, voteSlot } from "../db/rounds.ts";
import { testDatabase } from "./helpers/d1.ts";

const now = new Date("2026-11-16T10:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600000);

async function wonGathering(opts: { min?: number; max?: number; people?: number; voters?: number; place?: boolean } = {}) {
  const db = testDatabase();
  const people = opts.people ?? 6;
  for (let n = 1; n <= people; n++) {
    await db
      .prepare(`INSERT INTO person (id, auth_user_id, display_name, postcode_district, adult_confirmed_at, rules_version)
        VALUES (?1, ?1, ?2, 'SE15', '2026-11-16', 'r1')`)
      .bind(`p${n}`, `Person ${n}`)
      .run();
  }
  if (opts.place !== false) {
    await db
      .prepare(`INSERT INTO place (id, name, address, postcode_district, kind, step_free)
        VALUES ('pl1', 'Peckham Rye bandstand', 'Peckham Rye Park', 'SE15', 'public', 1)`)
      .run();
  }
  await db
    .prepare(`INSERT INTO activity (id, title, outcome, min_people, max_people, duration_min, place_kind, bring, state)
      VALUES ('a1', 'Litter pick', 'A cleaner park', ?1, ?2, 90, 'public', 'Gloves', 'in_catalogue')`)
    .bind(opts.min ?? 3, opts.max ?? 6)
    .run();
  const voters = opts.voters ?? opts.min ?? 3;
  for (let n = 1; n <= voters; n++) await setInterest(db, "a1", `p${n}`, []);
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  let gatheringId: string | null = null;
  for (let n = 1; n <= voters; n++) {
    const r = await voteSlot(db, slot.id, `p${n}`, true, new Date(now.getTime() + n * 1000));
    if (r.ok && r.gatheringId) gatheringId = r.gatheringId;
  }
  assert.ok(gatheringId);
  return { db, gatheringId };
}

const cardState = async (db: D1Database) =>
  (await db.prepare("SELECT state FROM activity WHERE id = 'a1'").first<{ state: string }>())!.state;

async function outbox(db: D1Database, template: string) {
  const { results } = await db
    .prepare("SELECT person_id AS personId, payload FROM email_outbox WHERE template = ?1 ORDER BY person_id")
    .bind(template)
    .all<{ personId: string; payload: string }>();
  return results;
}

const tokenFor = async (db: D1Database, personId: string) => {
  const rows = (await outbox(db, "host_offer")).filter((r) => r.personId === personId);
  return JSON.parse(rows.at(-1)!.payload).token as string;
};

test("a won slot offers hosting to the first person who said they can make it", async () => {
  const { db, gatheringId } = await wonGathering();
  const offers = await outbox(db, "host_offer");
  assert.deepEqual(offers.map((o) => o.personId), ["p1"]);
  const view = await getGathering(db, gatheringId, "p1");
  assert.equal(view!.status, "awaiting_place");
  assert.equal(view!.me!.hostOfferPending, true);
  assert.equal((await outbox(db, "round_opened")).length, 3);
});

test("accepting books the gathering with a public place; everyone going is emailed", async () => {
  const { db, gatheringId } = await wonGathering();
  const reply = await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.deepEqual(reply, { ok: true, scheduled: true });
  assert.equal(await cardState(db), "scheduled");
  const view = await getGathering(db, gatheringId, "p2");
  assert.equal(view!.status, "scheduled");
  assert.equal(view!.place!.name, "Peckham Rye bandstand");
  assert.equal(view!.going, 3);
  assert.equal(view!.hostName, "Person 1");
  assert.equal(view!.bring, "Gloves");
  // Someone not going sees that there is a host, not who.
  const outsider = await getGathering(db, gatheringId, "p5");
  assert.equal(outsider!.hostName, null);
  assert.equal(outsider!.hasHost, true);
  assert.equal((await outbox(db, "gathering_scheduled")).length, 3);
  // The link works once.
  assert.deepEqual(await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1)), { ok: false, reason: "invalid" });
});

test("a decline or silence passes hosting to the next person; nobody left cancels", async () => {
  const { db, gatheringId } = await wonGathering();
  await respondHostOffer(db, await tokenFor(db, "p1"), false, hours(1));
  assert.deepEqual((await outbox(db, "host_offer")).map((o) => o.personId), ["p1", "p2"]);

  assert.deepEqual(await respondHostOffer(db, await tokenFor(db, "p2"), true, hours(30)), { ok: false, reason: "expired" });
  await expireHostOffers(db, hours(30));
  assert.deepEqual((await outbox(db, "host_offer")).map((o) => o.personId), ["p1", "p2", "p3"]);

  await respondHostOffer(db, await tokenFor(db, "p3"), false, hours(31));
  const view = await getGathering(db, gatheringId, null);
  assert.equal(view!.status, "cancelled");
  assert.equal(await cardState(db), "in_catalogue");
  assert.equal((await outbox(db, "gathering_cancelled")).length, 3);
});

test("without a public place on the list the gathering is not booked", async () => {
  const { db, gatheringId } = await wonGathering({ place: false });
  const reply = await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.deepEqual(reply, { ok: true, scheduled: false });
  assert.equal((await getGathering(db, gatheringId, null))!.status, "awaiting_place");
});

test("people can join until the maximum, and leave at any time", async () => {
  const { db, gatheringId } = await wonGathering({ min: 2, max: 3 });
  assert.deepEqual(await joinGathering(db, gatheringId, "p4", hours(1)), { ok: true });
  assert.deepEqual(await joinGathering(db, gatheringId, "p5", hours(1)), { ok: false, reason: "full_or_closed" });
  assert.deepEqual(await leaveGathering(db, gatheringId, "p4", hours(2)), { left: true, belowMinimum: false });
  assert.deepEqual(await joinGathering(db, gatheringId, "p5", hours(2)), { ok: true });
  // Rejoining after leaving works too, if there is room.
  await leaveGathering(db, gatheringId, "p5", hours(3));
  assert.deepEqual(await joinGathering(db, gatheringId, "p4", hours(3)), { ok: true });
});

test("dropping below the minimum emails the rest once; they decide", async () => {
  const { db, gatheringId } = await wonGathering({ min: 3, voters: 4 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal((await leaveGathering(db, gatheringId, "p4", hours(2))).belowMinimum, false);
  assert.equal((await leaveGathering(db, gatheringId, "p3", hours(2))).belowMinimum, true);
  assert.equal((await leaveGathering(db, gatheringId, "p2", hours(3))).belowMinimum, false);
  assert.deepEqual((await outbox(db, "below_minimum")).map((o) => o.personId), ["p1", "p2"]);
  // Still booked: the people left decide whether to go.
  assert.equal((await getGathering(db, gatheringId, null))!.status, "scheduled");
});

test("when the host leaves, hosting goes to the next person and the card waits again", async () => {
  const { db, gatheringId } = await wonGathering({ voters: 4 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal(await cardState(db), "scheduled");
  await leaveGathering(db, gatheringId, "p1", hours(2));
  assert.equal(await cardState(db), "awaiting_place");
  assert.deepEqual((await outbox(db, "host_offer")).map((o) => o.personId), ["p1", "p2"]);
  await respondHostOffer(db, await tokenFor(db, "p2"), true, hours(3));
  assert.equal(await cardState(db), "scheduled");
  assert.equal((await getGathering(db, gatheringId, "p3"))!.hostName, "Person 2");
});

test("after the end time the gathering happened; the card is back and its goers are no longer counted", async () => {
  const { db, gatheringId } = await wonGathering({ min: 2, max: 2, voters: 3 });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  const view = (await getGathering(db, gatheringId, null))!;
  assert.equal(await completeGatherings(db, new Date(Date.parse(view.endsAt) + 1000)), 1);
  assert.equal(await cardState(db), "in_catalogue");
  const left = await db.prepare("SELECT person_id AS id, queued FROM interest").all<{ id: string; queued: number }>();
  assert.deepEqual(left.results.map((r) => ({ ...r })), [{ id: "p3", queued: 1 }]);
  const card = await db.prepare("SELECT times_run AS n FROM activity").first<{ n: number }>();
  assert.equal(card!.n, 1);
});

test("a gathering still without a host at its start time is cancelled", async () => {
  const { db, gatheringId } = await wonGathering();
  const view = (await getGathering(db, gatheringId, null))!;
  assert.equal(await cancelUnreadyGatherings(db, new Date(Date.parse(view.startsAt))), 1);
  assert.equal((await getGathering(db, gatheringId, null))!.status, "cancelled");
});

test("a moderator can cancel a booked gathering, and it is logged", async () => {
  const { db, gatheringId } = await wonGathering();
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal(await cancelGathering(db, gatheringId, "moderator", "p6", "Park closed"), true);
  assert.equal(await cardState(db), "in_catalogue");
  const log = await db.prepare("SELECT action, reason FROM mod_action").first<{ action: string; reason: string }>();
  assert.deepEqual({ ...log }, { action: "cancel_gathering", reason: "Park closed" });
});
