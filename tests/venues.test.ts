import assert from "node:assert/strict";
import test from "node:test";
import { getGathering, respondHostOffer } from "../db/gatherings.ts";
import { sendDueEmails } from "../db/mailer.ts";
import { expireVenueRequests, respondVenueRequest, viewVenueRequest } from "../db/venues.ts";
import type { OutgoingEmail } from "../db/ses.ts";
import { cardState, hours, outbox, tokenFor, wonGathering } from "./helpers/fixtures.ts";

const two = [
  { id: "hall", name: "A Church hall" },
  { id: "cafe", name: "B Café" },
];

async function venueToken(db: D1Database, placeId: string) {
  const { results } = await db
    .prepare("SELECT payload FROM email_outbox WHERE template = 'venue_request' AND place_id = ?1")
    .bind(placeId)
    .all<{ payload: string }>();
  return JSON.parse(results.at(-1)!.payload).token as string;
}

const venueAsks = async (db: D1Database) =>
  (await db.prepare("SELECT place_id AS p FROM email_outbox WHERE template = 'venue_request' ORDER BY created_at, rowid").all<{ p: string }>()).results.map((r) => r.p);

test("a won indoor card asks one venue, and hosting is offered at the same time", async () => {
  const { db } = await wonGathering({ venues: two });
  assert.equal(await cardState(db), "awaiting_place");
  assert.deepEqual(await venueAsks(db), ["hall"]);
  assert.equal((await outbox(db, "host_offer")).length, 1);
});

test("the venue sees the request without an account; opening it changes nothing", async () => {
  const { db } = await wonGathering({ venues: two });
  const view = await viewVenueRequest(db, await venueToken(db, "hall"), hours(1));
  assert.equal(view!.title, "Litter pick");
  assert.equal(view!.people, 3);
  assert.equal(view!.open, true);
  assert.equal(await viewVenueRequest(db, "0".repeat(64)), null);
});

test("approval plus a host books the gathering at that venue", async () => {
  const { db, gatheringId } = await wonGathering({ venues: two });
  assert.deepEqual(await respondVenueRequest(db, await venueToken(db, "hall"), true, hours(1)), { ok: true, scheduled: false });
  assert.equal((await getGathering(db, gatheringId, null))!.status, "awaiting_place");
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(2));
  const g = (await getGathering(db, gatheringId, "p2"))!;
  assert.equal(g.status, "scheduled");
  assert.equal(g.place!.name, "A Church hall");
  assert.equal(await cardState(db), "scheduled");
  assert.deepEqual(await respondVenueRequest(db, await venueToken(db, "hall"), false, hours(3)), { ok: false, reason: "answered" });
});

test("host first, then the venue: also booked", async () => {
  const { db, gatheringId } = await wonGathering({ venues: two });
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.deepEqual(await respondVenueRequest(db, await venueToken(db, "hall"), true, hours(2)), { ok: true, scheduled: true });
  assert.equal((await getGathering(db, gatheringId, null))!.status, "scheduled");
});

test("a decline or 48 hours of silence moves to the next venue; none left cancels and tells everyone", async () => {
  const { db, gatheringId } = await wonGathering({ venues: two });
  await respondVenueRequest(db, await venueToken(db, "hall"), false, hours(1));
  assert.deepEqual(await venueAsks(db), ["hall", "cafe"]);

  const late = hours(50);
  assert.equal(await expireVenueRequests(db, late), 1);
  const g = (await getGathering(db, gatheringId, null))!;
  assert.equal(g.status, "cancelled");
  assert.equal(await cardState(db), "in_catalogue");
  const cancelled = await outbox(db, "gathering_cancelled");
  assert.equal(cancelled.length, 3);
  assert.equal(JSON.parse(cancelled[0].payload).reason, "no_place");

  // The café answers after its request expired: told it was too late, nothing changes.
  assert.deepEqual(await respondVenueRequest(db, await venueToken(db, "cafe"), true, late), { ok: false, reason: "late" });
});

test("a late answer is noted but the request has already moved on", async () => {
  const { db } = await wonGathering({ venues: two });
  const token = await venueToken(db, "hall");
  assert.deepEqual(await respondVenueRequest(db, token, true, hours(49)), { ok: false, reason: "late" });
  const row = await db.prepare("SELECT response FROM venue_request WHERE place_id = 'hall'").first<{ response: string }>();
  assert.equal(row!.response, "late");
});

test("venues too small for the group are skipped", async () => {
  const { db } = await wonGathering({ venues: [{ id: "tiny", name: "A Tiny room", capacity: 2 }, { id: "cafe", name: "B Café" }] });
  assert.deepEqual(await venueAsks(db), ["cafe"]);
});

test("a standing window that approves itself books at once and only notifies the venue", async () => {
  const { db, gatheringId } = await wonGathering({
    venues: [
      { id: "hall", name: "A Church hall" },
      { id: "lib", name: "Z Library room", window: { weekday: 6, start: "10:00", end: "13:00", auto: true } },
    ],
  });
  assert.deepEqual(await venueAsks(db), []);
  const notice = await db.prepare("SELECT place_id AS p FROM email_outbox WHERE template = 'venue_auto_booked'").first<{ p: string }>();
  assert.equal(notice!.p, "lib");
  await respondHostOffer(db, await tokenFor(db, "p1"), true, hours(1));
  assert.equal((await getGathering(db, gatheringId, null))!.place!.name, "Z Library room");
});

test("venue emails go to the venue's booking address and carry its answer link", async () => {
  const { db } = await wonGathering({ venues: two });
  const sent: OutgoingEmail[] = [];
  await sendDueEmails(db, { siteUrl: "https://example.org", lookupEmail: async (id) => `${id}@example.org`, send: async (m) => (sent.push(m), "x") }, hours(0.1));
  const toVenue = sent.find((m) => m.to === "hall@venue.example")!;
  assert.match(toVenue.subject, /Room request: Litter pick/);
  assert.match(toVenue.text, /\/venue\?token=[0-9a-f]{64}/);
  assert.match(toVenue.text, /doesn’t take payments/);
});

test("a venue that said yes is told when the gathering is cancelled", async () => {
  const { db, gatheringId } = await wonGathering({ venues: two });
  await respondVenueRequest(db, await venueToken(db, "hall"), true, hours(1));
  const { cancelGathering } = await import("../db/gatherings.ts");
  await cancelGathering(db, gatheringId, "moderator", "p6", "Hall flooded");
  const n = await db.prepare("SELECT count(*) AS n FROM email_outbox WHERE template = 'venue_cancelled' AND place_id = 'hall'").first<{ n: number }>();
  assert.equal(n!.n, 1);
});

test("with no indoor venue on the list, the group is told straight away", async () => {
  const { db } = await wonGathering({ venues: [] });
  assert.equal(await cardState(db), "in_catalogue");
  assert.equal((await outbox(db, "gathering_cancelled")).length, 3);
});
