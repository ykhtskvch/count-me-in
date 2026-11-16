// The gathering and its host (backlog 6.1–6.5, PRD GAT-01..GAT-05).
//
// A gathering is created when a slot wins (db/rounds.ts). It is booked ("scheduled")
// only once it has a host and a place (GAT-02, PLC-01): the database refuses a scheduled
// gathering without both. Hosting is offered to people going, earliest first; one offer
// is open at a time, and a decline or no answer passes it to the next person. If nobody
// is left, the gathering is cancelled and the card goes back to the catalogue.
import { type CardEvent, type CardState, canTransition, nextState } from "../lib/card-state.ts";
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { GOING_SQL, queueToPeople, queueToPlace } from "./outbox.ts";
import { createToken, hashSecret } from "./runtime.ts";

const HOUR_MS = 60 * 60 * 1000;
const LIVE = "('awaiting_place', 'scheduled')";

export type GatheringView = {
  id: string;
  status: "awaiting_place" | "scheduled" | "cancelled" | "happened";
  activityId: string;
  title: string;
  outcome: string;
  bring: string;
  minPeople: number;
  maxPeople: number;
  startsAt: string;
  endsAt: string;
  going: number;
  /** Joining closes when the gathering starts. */
  started: boolean;
  place: { name: string; address: string; stepFree: boolean; facilities: string } | null;
  hasHost: boolean;
  /** Only for people going: the host's display name. */
  hostName: string | null;
  me: { going: boolean; isHost: boolean; hostOfferPending: boolean } | null;
};

type Core = {
  id: string;
  status: GatheringView["status"];
  activityId: string;
  cardState: CardState;
  placeKind: "venue" | "public";
  placeId: string | null;
  hostPersonId: string | null;
  minPeople: number;
  maxPeople: number;
  startsAt: string;
  going: number;
};

async function core(db: D1Database, gatheringId: string): Promise<Core | null> {
  return db
    .prepare(`SELECT g.id, g.status, a.id AS activityId, a.state AS cardState, a.place_kind AS placeKind,
        g.place_id AS placeId, g.host_person_id AS hostPersonId, a.min_people AS minPeople,
        a.max_people AS maxPeople, s.starts_at AS startsAt,
        (SELECT count(*) FROM attendance at JOIN person p ON p.id = at.person_id AND p.blocked_at IS NULL
          WHERE at.gathering_id = g.id AND at.status = 'going') AS going
      FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id
      WHERE g.id = ?1`)
    .bind(gatheringId)
    .first<Core>();
}

/** GAT-01: what the gathering page shows. Other people going are counted, never named. */
export async function getGathering(
  db: D1Database,
  gatheringId: string,
  personId: string | null,
  now = new Date(),
): Promise<GatheringView | null> {
  const row = await db
    .prepare(`SELECT g.id, g.status, a.id AS activityId, a.title, a.outcome, a.bring,
        a.min_people AS minPeople, a.max_people AS maxPeople, s.starts_at AS startsAt, s.ends_at AS endsAt,
        (SELECT count(*) FROM attendance at JOIN person p ON p.id = at.person_id AND p.blocked_at IS NULL
          WHERE at.gathering_id = g.id AND at.status = 'going') AS going,
        pl.name AS placeName, pl.address AS placeAddress, pl.step_free AS stepFree, pl.facilities,
        g.host_person_id AS hostPersonId, host.display_name AS hostName,
        (SELECT status FROM attendance WHERE gathering_id = g.id AND person_id = ?2) AS myStatus,
        EXISTS (SELECT 1 FROM host_offer o WHERE o.gathering_id = g.id AND o.person_id = ?2 AND o.response IS NULL) AS offerPending
      FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id
      LEFT JOIN place pl ON pl.id = g.place_id
      LEFT JOIN person host ON host.id = g.host_person_id
      WHERE g.id = ?1 AND a.state <> 'removed'`)
    .bind(gatheringId, personId ?? "")
    .first<{
      id: string; status: GatheringView["status"]; activityId: string; title: string; outcome: string; bring: string;
      minPeople: number; maxPeople: number; startsAt: string; endsAt: string; going: number;
      placeName: string | null; placeAddress: string | null; stepFree: number | null; facilities: string | null;
      hostPersonId: string | null; hostName: string | null; myStatus: string | null; offerPending: number;
    }>();
  if (!row) return null;
  const going = row.myStatus === "going";
  return {
    id: row.id,
    status: row.status,
    activityId: row.activityId,
    title: row.title,
    outcome: row.outcome,
    bring: row.bring,
    minPeople: row.minPeople,
    maxPeople: row.maxPeople,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    going: row.going,
    started: row.startsAt <= now.toISOString(),
    place: row.placeName
      ? { name: row.placeName, address: row.placeAddress ?? "", stepFree: Boolean(row.stepFree), facilities: row.facilities ?? "" }
      : null,
    hasHost: row.hostPersonId !== null,
    hostName: going ? row.hostName : null,
    me: personId
      ? { going, isHost: personId === row.hostPersonId, hostOfferPending: Boolean(row.offerPending) }
      : null,
  };
}

/** The live gathering of a card, if any, for linking from the activity page. */
export async function activeGatheringId(db: D1Database, activityId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT g.id FROM gathering g JOIN round r ON r.id = g.round_id
      WHERE r.activity_id = ?1 AND g.status IN ${LIVE} LIMIT 1`)
    .bind(activityId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export type OfferResult = { offeredTo: string } | { waiting: true } | { cancelled: true } | { notNeeded: true };

/**
 * GAT-02: offers hosting to the next person going who has not been asked yet.
 * Cancels the gathering if nobody is left to ask.
 */
export async function offerHostToNext(
  db: D1Database,
  gatheringId: string,
  now = new Date(),
  settings = DEFAULT_SETTINGS,
): Promise<OfferResult> {
  const g = await core(db, gatheringId);
  if (!g || g.hostPersonId || !["awaiting_place", "scheduled"].includes(g.status)) return { notNeeded: true };
  const pending = await db
    .prepare("SELECT 1 AS ok FROM host_offer WHERE gathering_id = ?1 AND response IS NULL")
    .bind(gatheringId)
    .first();
  if (pending) return { waiting: true };

  const next = await db
    .prepare(`SELECT at.person_id AS personId FROM attendance at
      JOIN person p ON p.id = at.person_id AND p.blocked_at IS NULL
      WHERE at.gathering_id = ?1 AND at.status = 'going'
        AND at.person_id NOT IN (SELECT person_id FROM host_offer WHERE gathering_id = ?1)
      ORDER BY at.joined_at, at.person_id LIMIT 1`)
    .bind(gatheringId)
    .first<{ personId: string }>();
  if (!next) {
    await cancelGathering(db, gatheringId, "no_host");
    return { cancelled: true };
  }

  const token = createToken();
  const deadline = new Date(Math.min(now.getTime() + settings.host_reply_hours * HOUR_MS, Date.parse(g.startsAt)));
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO host_offer (id, gathering_id, person_id, sent_at, deadline_at, token_hash)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(crypto.randomUUID(), gatheringId, next.personId, now.toISOString(), deadline.toISOString(), await hashSecret(token)),
      queueToPeople(db, "host_offer", { gatheringId, token, deadlineAt: deadline.toISOString() }, "SELECT ?1 AS person_id", [
        next.personId,
      ]),
    ]);
  } catch {
    // Offered to the same person at the same moment by another request (host_offer_once).
    return { waiting: true };
  }
  return { offeredTo: next.personId };
}

export type HostReply = { ok: true; scheduled: boolean } | { ok: false; reason: "invalid" | "expired" };

/** GAT-02: the person answers the hosting offer from the link in their email. */
export async function respondHostOffer(db: D1Database, token: string, accept: boolean, now = new Date()): Promise<HostReply> {
  const offer = await db
    .prepare(`SELECT o.id, o.gathering_id AS gatheringId, o.person_id AS personId, o.deadline_at AS deadlineAt
      FROM host_offer o JOIN gathering g ON g.id = o.gathering_id
      JOIN attendance at ON at.gathering_id = o.gathering_id AND at.person_id = o.person_id AND at.status = 'going'
      WHERE o.token_hash = ?1 AND o.response IS NULL AND g.status IN ${LIVE}`)
    .bind(await hashSecret(token))
    .first<{ id: string; gatheringId: string; personId: string; deadlineAt: string }>();
  if (!offer) return { ok: false, reason: "invalid" };
  if (offer.deadlineAt <= now.toISOString()) return { ok: false, reason: "expired" };

  if (!accept) {
    await db.prepare("UPDATE host_offer SET response = 'declined' WHERE id = ?1 AND response IS NULL").bind(offer.id).run();
    await offerHostToNext(db, offer.gatheringId, now);
    return { ok: true, scheduled: false };
  }

  await db.batch([
    db.prepare("UPDATE host_offer SET response = 'accepted' WHERE id = ?1 AND response IS NULL").bind(offer.id),
    db
      .prepare("UPDATE gathering SET host_person_id = ?2 WHERE id = ?1 AND host_person_id IS NULL")
      .bind(offer.gatheringId, offer.personId),
  ]);
  return { ok: true, scheduled: await trySchedule(db, offer.gatheringId) };
}

/**
 * Books the gathering once it has a host and a place. A public card gets a public place
 * from the moderator's list here (PLC-01); a venue card waits for a venue to approve.
 */
export async function trySchedule(db: D1Database, gatheringId: string): Promise<boolean> {
  const g = await core(db, gatheringId);
  if (!g || g.status !== "awaiting_place" || !g.hostPersonId) return false;

  let placeId = g.placeId;
  if (!placeId && g.placeKind === "public") {
    // Prefer a place in the district most of the people going live in (interim, see В5 and GAT-08).
    const place = await db
      .prepare(`SELECT pl.id FROM place pl
        WHERE pl.kind = 'public' AND pl.active = 1 AND (pl.capacity IS NULL OR pl.capacity >= ?2)
        ORDER BY (SELECT count(*) FROM attendance at JOIN person p ON p.id = at.person_id
          WHERE at.gathering_id = ?1 AND at.status = 'going' AND p.postcode_district = pl.postcode_district) DESC,
          pl.name
        LIMIT 1`)
      .bind(gatheringId, g.maxPeople)
      .first<{ id: string }>();
    placeId = place?.id ?? null;
  }
  if (!placeId) return false;

  const event: CardEvent = g.placeKind === "public" ? "host_confirmed_no_venue" : "venue_and_host_confirmed";
  if (!canTransition(g.cardState, event)) return false;
  const cardTo = nextState(g.cardState, event);
  const [, booked] = await db.batch([
    queueToPeople(
      db,
      "gathering_scheduled",
      { gatheringId },
      `${GOING_SQL(1)} AND EXISTS (SELECT 1 FROM gathering WHERE id = ?1 AND status = 'awaiting_place')`,
      [gatheringId],
    ),
    db
      .prepare(`UPDATE gathering SET place_id = ?2, status = 'scheduled'
        WHERE id = ?1 AND status = 'awaiting_place' AND host_person_id IS NOT NULL`)
      .bind(gatheringId, placeId),
    db.prepare("UPDATE activity SET state = ?2 WHERE id = ?1 AND state = ?3").bind(g.activityId, cardTo, g.cardState),
  ]);
  return booked.meta.changes > 0;
}

export type JoinResult = { ok: true } | { ok: false; reason: "full_or_closed" };

/** GAT-03: anyone signed in can join a live gathering until it is full or has started. */
export async function joinGathering(db: D1Database, gatheringId: string, personId: string, now = new Date()): Promise<JoinResult> {
  const result = await db
    .prepare(`INSERT INTO attendance (gathering_id, person_id, joined_at)
      SELECT g.id, ?2, ?3 FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id
      WHERE g.id = ?1 AND g.status IN ${LIVE} AND s.starts_at > ?3
        AND (SELECT count(*) FROM attendance at JOIN person p ON p.id = at.person_id AND p.blocked_at IS NULL
          WHERE at.gathering_id = g.id AND at.status = 'going') < a.max_people
      ON CONFLICT(gathering_id, person_id) DO UPDATE SET status = 'going', joined_at = excluded.joined_at
        WHERE attendance.status = 'left'`)
    .bind(gatheringId, personId, now.toISOString())
    .run();
  if (result.meta.changes) {
    await db
      .prepare(`UPDATE interest SET queued = 0 WHERE person_id = ?2
        AND activity_id = (SELECT r.activity_id FROM gathering g JOIN round r ON r.id = g.round_id WHERE g.id = ?1)`)
      .bind(gatheringId, personId)
      .run();
    return { ok: true };
  }
  const mine = await db
    .prepare("SELECT status FROM attendance WHERE gathering_id = ?1 AND person_id = ?2")
    .bind(gatheringId, personId)
    .first<{ status: string }>();
  return mine?.status === "going" ? { ok: true } : { ok: false, reason: "full_or_closed" };
}

/**
 * GAT-04: leaving is always allowed and has no consequences. If the host leaves, hosting
 * is offered to the next person. GAT-05: when the number going drops below the minimum,
 * everyone still going gets one email and decides for themselves.
 */
export async function leaveGathering(
  db: D1Database,
  gatheringId: string,
  personId: string,
  now = new Date(),
): Promise<{ left: boolean; belowMinimum: boolean }> {
  const before = await core(db, gatheringId);
  if (!before || !["awaiting_place", "scheduled"].includes(before.status)) return { left: false, belowMinimum: false };

  const wasHost = before.hostPersonId === personId;
  const statements = [
    db
      .prepare("UPDATE attendance SET status = 'left' WHERE gathering_id = ?1 AND person_id = ?2 AND status = 'going'")
      .bind(gatheringId, personId),
    // A pending hosting offer to this person lapses.
    db
      .prepare("UPDATE host_offer SET response = 'declined' WHERE gathering_id = ?1 AND person_id = ?2 AND response IS NULL")
      .bind(gatheringId, personId),
  ];
  if (wasHost) {
    statements.push(
      db
        .prepare("UPDATE gathering SET host_person_id = NULL, status = 'awaiting_place' WHERE id = ?1 AND host_person_id = ?2")
        .bind(gatheringId, personId),
    );
    if (before.status === "scheduled") {
      statements.push(
        db
          .prepare("UPDATE activity SET state = ?2 WHERE id = ?1 AND state = 'scheduled'")
          .bind(before.activityId, nextState("scheduled", "host_left")),
      );
    }
  }
  const [left] = await db.batch(statements);
  if (!left.meta.changes) return { left: false, belowMinimum: false };

  // Only the leave that crosses the line sends the email, not every leave after it.
  const belowMinimum = before.going === before.minPeople;
  if (belowMinimum) {
    await queueToPeople(db, "below_minimum", { gatheringId }, GOING_SQL(1), [gatheringId]).run();
  }
  if (wasHost || before.hostPersonId === null) await offerHostToNext(db, gatheringId, now);
  return { left: true, belowMinimum };
}

/** Cancels a live gathering (no host found, or a moderator, 8.4). The card goes back to the catalogue. */
export async function cancelGathering(
  db: D1Database,
  gatheringId: string,
  reason: "no_host" | "no_place" | "moderator",
  actorId: string | null = null,
  note: string | null = null,
): Promise<boolean> {
  const g = await core(db, gatheringId);
  if (!g || !["awaiting_place", "scheduled"].includes(g.status)) return false;
  // A removed card has nowhere to go; the gathering is still cancelled.
  const cancel = db.prepare(`UPDATE gathering SET status = 'cancelled' WHERE id = ?1 AND status IN ${LIVE}`).bind(gatheringId);
  const event: CardEvent = reason === "no_place" ? "no_places_left" : "gathering_cancelled";
  const cardTo = canTransition(g.cardState, event) ? nextState(g.cardState, event) : g.cardState;
  const statements = [
    // A venue that had said yes is told the room is no longer needed.
    ...(g.placeId && g.placeKind === "venue"
      ? [queueToPlace(db, "venue_cancelled", { gatheringId }, g.placeId, `EXISTS (SELECT 1 FROM gathering WHERE id = ?1 AND status IN ${LIVE})`, [gatheringId])]
      : []),
    queueToPeople(
      db,
      "gathering_cancelled",
      { gatheringId, reason },
      `${GOING_SQL(1)} AND EXISTS (SELECT 1 FROM gathering WHERE id = ?1 AND status IN ${LIVE})`,
      [gatheringId],
    ),
    cancel,
    db
      .prepare("UPDATE host_offer SET response = 'expired' WHERE gathering_id = ?1 AND response IS NULL")
      .bind(gatheringId),
    db
      .prepare("UPDATE venue_request SET response = 'expired' WHERE gathering_id = ?1 AND response IS NULL")
      .bind(gatheringId),
    db
      .prepare("UPDATE activity SET state = ?2 WHERE id = ?1 AND state = ?3")
      .bind(g.activityId, cardTo, g.cardState),
  ];
  if (actorId) {
    statements.push(
      db
        .prepare(`INSERT INTO mod_action (id, actor_id, action, target_kind, target_id, reason)
          VALUES (?1, ?2, 'cancel_gathering', 'gathering', ?3, ?4)`)
        .bind(crypto.randomUUID(), actorId, gatheringId, note),
    );
  }
  const results = await db.batch(statements);
  return results[statements.indexOf(cancel)].meta.changes > 0;
}

/** Scheduler: hosting offers nobody answered in time pass to the next person (GAT-02). */
export async function expireHostOffers(db: D1Database, now = new Date()): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, gathering_id AS gatheringId FROM host_offer WHERE response IS NULL AND deadline_at <= ?1")
    .bind(now.toISOString())
    .all<{ id: string; gatheringId: string }>();
  for (const offer of results) {
    const done = await db
      .prepare("UPDATE host_offer SET response = 'expired' WHERE id = ?1 AND response IS NULL")
      .bind(offer.id)
      .run();
    if (done.meta.changes) await offerHostToNext(db, offer.gatheringId, now);
  }
  return results.length;
}

/**
 * Scheduler: a gathering still without a host or place when it is due to start is
 * cancelled (assumption: the PRD says only that it is not booked without a host).
 */
export async function cancelUnreadyGatherings(db: D1Database, now = new Date()): Promise<number> {
  const { results } = await db
    .prepare(`SELECT g.id, g.host_person_id IS NULL AS noHost FROM gathering g JOIN slot s ON s.id = g.slot_id
      WHERE g.status = 'awaiting_place' AND s.starts_at <= ?1`)
    .bind(now.toISOString())
    .all<{ id: string; noHost: number }>();
  for (const g of results) await cancelGathering(db, g.id, g.noHost ? "no_host" : "no_place");
  return results.length;
}

/**
 * Scheduler: a booked gathering whose end time has passed happened. The card goes back
 * to the catalogue and can gather again; the people who went no longer count as
 * interested, while those queued keep their place for next time (TIME-05).
 */
export async function completeGatherings(db: D1Database, now = new Date()): Promise<number> {
  const { results } = await db
    .prepare(`SELECT g.id, r.activity_id AS activityId FROM gathering g JOIN slot s ON s.id = g.slot_id
      JOIN round r ON r.id = g.round_id WHERE g.status = 'scheduled' AND s.ends_at <= ?1`)
    .bind(now.toISOString())
    .all<{ id: string; activityId: string }>();
  const back = nextState("scheduled", "gathering_happened");
  for (const g of results) {
    await db.batch([
      db
        .prepare(`DELETE FROM interest WHERE activity_id = ?2 AND person_id IN
          (SELECT person_id FROM attendance WHERE gathering_id = ?1 AND status = 'going')
          AND EXISTS (SELECT 1 FROM gathering WHERE id = ?1 AND status = 'scheduled')`)
        .bind(g.id, g.activityId),
      db.prepare("UPDATE gathering SET status = 'happened' WHERE id = ?1 AND status = 'scheduled'").bind(g.id),
      db
        .prepare("UPDATE activity SET state = ?2, times_run = times_run + 1 WHERE id = ?1 AND state = 'scheduled'")
        .bind(g.activityId, back),
    ]);
  }
  return results.length;
}
