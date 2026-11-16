import assert from "node:assert/strict";
import test from "node:test";
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
import { cardState, hours, outbox, tokenFor, wonGathering } from "./helpers/fixtures.ts";

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
