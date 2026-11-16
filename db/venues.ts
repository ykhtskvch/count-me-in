// Booking an indoor venue (backlog 5.2–5.4, PRD PLC-03, PLC-04, PLC-05).
//
// When a slot wins on an indoor card, the platform asks one venue at a time, by email
// in the platform's name: what the activity is, the date and how many people. The venue
// answers with a button, without an account. A decline, or no answer within
// `venue_reply_hours`, moves the request to the next suitable venue. If none is left,
// everyone going is told and the gathering does not go ahead (PLC-04).
// A venue whose standing window covers the slot, marked to approve itself, is booked
// at once and only notified (PLC-05).
//
// Suitable means: an active indoor venue from the moderator's list, big enough for the
// people going, not asked before for this gathering. Venues whose standing window covers
// the slot come first, then venues in the district most people going live in.
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { londonParts } from "../lib/slots.ts";
import { cancelGathering, trySchedule } from "./gatherings.ts";
import { queueToPlace } from "./outbox.ts";
import { createToken, hashSecret } from "./runtime.ts";

const HOUR_MS = 60 * 60 * 1000;

type Need = {
  id: string;
  status: string;
  placeId: string | null;
  placeKind: string;
  startsAt: string;
  endsAt: string;
  going: number;
};

async function need(db: D1Database, gatheringId: string): Promise<Need | null> {
  return db
    .prepare(`SELECT g.id, g.status, g.place_id AS placeId, a.place_kind AS placeKind,
        s.starts_at AS startsAt, s.ends_at AS endsAt,
        (SELECT count(*) FROM attendance at WHERE at.gathering_id = g.id AND at.status = 'going') AS going
      FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id WHERE g.id = ?1`)
    .bind(gatheringId)
    .first<Need>();
}

/** "HH:MM" in London for an ISO instant. */
function londonTime(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() + londonParts(d).offsetMin * 60000);
  return local.toISOString().slice(11, 16);
}

export type VenueStep =
  | { requested: string }
  | { autoBooked: string }
  | { waiting: true }
  | { noPlacesLeft: true }
  | { notNeeded: true };

/** PLC-03/PLC-05: asks the next suitable venue, or books one with a standing window. */
export async function requestNextVenue(
  db: D1Database,
  gatheringId: string,
  now = new Date(),
  settings = DEFAULT_SETTINGS,
): Promise<VenueStep> {
  const g = await need(db, gatheringId);
  if (!g || g.placeKind !== "venue" || g.status !== "awaiting_place" || g.placeId) return { notNeeded: true };
  const pending = await db
    .prepare("SELECT 1 AS ok FROM venue_request WHERE gathering_id = ?1 AND response IS NULL")
    .bind(gatheringId)
    .first();
  if (pending) return { waiting: true };

  // A venue must have at least a day before the start to answer (assumption, see В9).
  const latestAnswer = Date.parse(g.startsAt) - 24 * HOUR_MS;
  const deadline = new Date(Math.min(now.getTime() + settings.venue_reply_hours * HOUR_MS, latestAnswer));
  if (deadline.getTime() <= now.getTime()) {
    await cancelGathering(db, gatheringId, "no_place");
    return { noPlacesLeft: true };
  }

  const start = new Date(g.startsAt);
  const weekday = londonParts(start).weekday;
  const from = londonTime(g.startsAt);
  const to = londonTime(g.endsAt);
  const place = await db
    .prepare(`SELECT pl.id,
        (SELECT max(w.auto_approve) FROM place_window w WHERE w.place_id = pl.id AND w.weekday = ?3
          AND w.start_time <= ?4 AND w.end_time >= ?5) AS windowAuto
      FROM place pl
      WHERE pl.kind = 'venue' AND pl.active = 1 AND pl.booking_email IS NOT NULL
        AND (pl.capacity IS NULL OR pl.capacity >= ?2)
        AND pl.id NOT IN (SELECT place_id FROM venue_request WHERE gathering_id = ?1)
      ORDER BY windowAuto IS NULL,
        (SELECT count(*) FROM attendance at JOIN person p ON p.id = at.person_id
          WHERE at.gathering_id = ?1 AND at.status = 'going' AND p.postcode_district = pl.postcode_district) DESC,
        pl.name
      LIMIT 1`)
    .bind(gatheringId, g.going, weekday, from, to)
    .first<{ id: string; windowAuto: number | null }>();

  if (!place) {
    await cancelGathering(db, gatheringId, "no_place");
    return { noPlacesLeft: true };
  }

  const token = createToken();
  const auto = place.windowAuto === 1;
  const requestId = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO venue_request (id, gathering_id, place_id, sent_at, deadline_at, token_hash, response, responded_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(
          requestId,
          gatheringId,
          place.id,
          now.toISOString(),
          deadline.toISOString(),
          await hashSecret(token),
          auto ? "approved" : null,
          auto ? now.toISOString() : null,
        ),
      ...(auto
        ? [
            db
              .prepare("UPDATE gathering SET place_id = ?2 WHERE id = ?1 AND place_id IS NULL AND status = 'awaiting_place'")
              .bind(gatheringId, place.id),
            queueToPlace(db, "venue_auto_booked", { gatheringId }, place.id),
          ]
        : [queueToPlace(db, "venue_request", { gatheringId, token, deadlineAt: deadline.toISOString() }, place.id)]),
    ]);
  } catch {
    // Asked at the same moment by another request (venue_request_once).
    return { waiting: true };
  }
  if (auto) {
    await trySchedule(db, gatheringId);
    return { autoBooked: place.id };
  }
  return { requested: place.id };
}

export type VenueRequestView = {
  title: string;
  outcome: string;
  startsAt: string;
  endsAt: string;
  people: number;
  maxPeople: number;
  placeName: string;
  deadlineAt: string;
  open: boolean;
};

async function findRequest(db: D1Database, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return db
    .prepare(`SELECT v.id, v.gathering_id AS gatheringId, v.place_id AS placeId, v.deadline_at AS deadlineAt,
        v.response, g.status, a.title, a.outcome, a.max_people AS maxPeople, s.starts_at AS startsAt, s.ends_at AS endsAt,
        pl.name AS placeName,
        (SELECT count(*) FROM attendance at WHERE at.gathering_id = g.id AND at.status = 'going') AS people
      FROM venue_request v JOIN gathering g ON g.id = v.gathering_id JOIN slot s ON s.id = g.slot_id
      JOIN round r ON r.id = g.round_id JOIN activity a ON a.id = r.activity_id JOIN place pl ON pl.id = v.place_id
      WHERE v.token_hash = ?1`)
    .bind(await hashSecret(token))
    .first<{
      id: string; gatheringId: string; placeId: string; deadlineAt: string; response: string | null; status: string;
      title: string; outcome: string; maxPeople: number; startsAt: string; endsAt: string; placeName: string; people: number;
    }>();
}

/** What the venue sees behind its link. Opening the link changes nothing. */
export async function viewVenueRequest(db: D1Database, token: string, now = new Date()): Promise<VenueRequestView | null> {
  const r = await findRequest(db, token);
  if (!r) return null;
  return {
    title: r.title,
    outcome: r.outcome,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    people: r.people,
    maxPeople: r.maxPeople,
    placeName: r.placeName,
    deadlineAt: r.deadlineAt,
    open: r.response === null && r.status === "awaiting_place" && r.deadlineAt > now.toISOString(),
  };
}

export type VenueReply =
  | { ok: true; scheduled: boolean }
  | { ok: false; reason: "invalid" | "answered" | "late" | "cancelled" };

/** PLC-03: the venue approves or declines from the link. PLC-04: a late answer is recorded but not used. */
export async function respondVenueRequest(db: D1Database, token: string, approve: boolean, now = new Date()): Promise<VenueReply> {
  const r = await findRequest(db, token);
  if (!r) return { ok: false, reason: "invalid" };
  if (r.response === "expired") return { ok: false, reason: "late" };
  if (r.response !== null) return { ok: false, reason: "answered" };
  if (r.status !== "awaiting_place") return { ok: false, reason: "cancelled" };
  if (r.deadlineAt <= now.toISOString()) {
    await db
      .prepare("UPDATE venue_request SET response = 'late', responded_at = ?2 WHERE id = ?1 AND response IS NULL")
      .bind(r.id, now.toISOString())
      .run();
    return { ok: false, reason: "late" };
  }

  if (!approve) {
    await db
      .prepare("UPDATE venue_request SET response = 'declined', responded_at = ?2 WHERE id = ?1 AND response IS NULL")
      .bind(r.id, now.toISOString())
      .run();
    await requestNextVenue(db, r.gatheringId, now);
    return { ok: true, scheduled: false };
  }

  const [answered] = await db.batch([
    db
      .prepare("UPDATE venue_request SET response = 'approved', responded_at = ?2 WHERE id = ?1 AND response IS NULL")
      .bind(r.id, now.toISOString()),
    db
      .prepare("UPDATE gathering SET place_id = ?2 WHERE id = ?1 AND place_id IS NULL AND status = 'awaiting_place'")
      .bind(r.gatheringId, r.placeId),
  ]);
  if (!answered.meta.changes) return { ok: false, reason: "answered" };
  return { ok: true, scheduled: await trySchedule(db, r.gatheringId) };
}

/** Scheduler, PLC-04: requests nobody answered in time move on to the next venue. */
export async function expireVenueRequests(db: D1Database, now = new Date()): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, gathering_id AS gatheringId FROM venue_request WHERE response IS NULL AND deadline_at <= ?1")
    .bind(now.toISOString())
    .all<{ id: string; gatheringId: string }>();
  for (const r of results) {
    const done = await db
      .prepare("UPDATE venue_request SET response = 'expired', responded_at = ?2 WHERE id = ?1 AND response IS NULL")
      .bind(r.id, now.toISOString())
      .run();
    if (done.meta.changes) await requestNextVenue(db, r.gatheringId, now);
  }
  return results.length;
}
