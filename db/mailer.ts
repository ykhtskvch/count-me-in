// Sends queued emails (epic 7). Called by the scheduler; the SES call and the address
// lookup are passed in, so the logic is tested without either.
//
// Each email is claimed before sending (attempts + 1 with a compare), so two overlapping
// runs never send it twice. An email whose reason has gone (the offer was answered, the
// round closed, the gathering was cancelled) is dropped, not sent late.
import { renderEmail, type EmailFacts } from "../lib/emails.ts";
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { getGathering } from "./gatherings.ts";
import { GOING_SQL, type Template, queueToPeople } from "./outbox.ts";
import { hashSecret } from "./runtime.ts";
import type { OutgoingEmail } from "./ses.ts";

export const MAX_ATTEMPTS = 5;

export type MailerDeps = {
  siteUrl: string;
  /** The address from Supabase Auth; D1 never stores it. */
  lookupEmail(authUserId: string): Promise<string | null>;
  send(message: OutgoingEmail): Promise<string | null>;
};

type Row = {
  id: string;
  template: Template;
  payload: string;
  personId: string | null;
  authUserId: string | null;
  /** For emails to a venue: its booking address, which the moderator entered (not a participant's). */
  placeEmail: string | null;
  attempts: number;
};
type Payload = { activityId?: string; roundId?: string; gatheringId?: string; token?: string; deadlineAt?: string; reason?: "no_host" | "no_place" | "moderator" };

/** The facts an email needs, or null when it is no longer relevant and should be dropped. */
async function loadFacts(db: D1Database, row: Row, payload: Payload, siteUrl: string): Promise<EmailFacts | null> {
  if (row.template === "round_opened" || row.template === "round_failed") {
    const round = await db
      .prepare(`SELECT r.outcome, r.closes_at AS closesAt, a.id AS activityId, a.title FROM round r
        JOIN activity a ON a.id = r.activity_id WHERE r.id = ?1 AND a.state <> 'removed'`)
      .bind(payload.roundId ?? "")
      .first<{ outcome: string; closesAt: string; activityId: string; title: string }>();
    if (!round) return null;
    if (row.template === "round_opened" && round.outcome !== "open") return null;
    return { siteUrl, title: round.title, activityId: round.activityId, closesAt: round.closesAt };
  }

  if (row.template.startsWith("venue_")) return venueFacts(db, row, payload, siteUrl);
  if (row.template === "card_published" || row.template === "card_rejected") {
    const card = await db
      .prepare("SELECT id, title, state, rejection_reason AS reason FROM activity WHERE id = ?1")
      .bind(payload.activityId ?? "")
      .first<{ id: string; title: string; state: string; reason: string | null }>();
    if (!card) return null;
    if (row.template === "card_published" && card.state === "removed") return null;
    return { siteUrl, title: card.title, activityId: card.id, note: card.reason ?? undefined };
  }

  const g = await getGathering(db, payload.gatheringId ?? "", row.personId);
  if (!g) return null;
  if (row.template === "followup") {
    const open = await db
      .prepare("SELECT 1 AS ok FROM followup WHERE token_hash = ?1 AND answered_at IS NULL")
      .bind(await hashSecret(payload.token ?? ""))
      .first();
    if (!open || g.status !== "happened") return null;
    return { siteUrl, title: g.title, activityId: g.activityId, gatheringId: g.id, startsAt: g.startsAt, endsAt: g.endsAt, token: payload.token };
  }
  const live = g.status === "awaiting_place" || g.status === "scheduled";
  if (row.template === "host_offer") {
    const pending = await db
      .prepare("SELECT 1 AS ok FROM host_offer WHERE token_hash = ?1 AND response IS NULL")
      .bind(await hashSecret(payload.token ?? ""))
      .first();
    if (!pending || !live) return null;
  }
  if ((row.template === "gathering_scheduled" || row.template === "reminder") && g.status !== "scheduled") return null;
  if (row.template === "below_minimum" && (!live || g.going >= g.minPeople)) return null;
  if (row.template !== "gathering_cancelled" && !g.me?.going) return null;

  return {
    siteUrl,
    title: g.title,
    activityId: g.activityId,
    gatheringId: g.id,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    place: g.place,
    bring: g.bring,
    hostName: g.hostName,
    minPeople: g.minPeople,
    going: g.going,
    token: payload.token,
    deadlineAt: payload.deadlineAt,
    reason: payload.reason,
  };
}

export async function sendDueEmails(
  db: D1Database,
  deps: MailerDeps,
  now = new Date(),
  limit = 25,
): Promise<{ sent: number; dropped: number; failed: number }> {
  const { results } = await db
    .prepare(`SELECT o.id, o.template, o.payload, o.person_id AS personId, p.auth_user_id AS authUserId,
        pl.booking_email AS placeEmail, o.attempts
      FROM email_outbox o LEFT JOIN person p ON p.id = o.person_id LEFT JOIN place pl ON pl.id = o.place_id
      WHERE o.sent_at IS NULL AND o.attempts < ?1
        AND ((p.id IS NOT NULL AND p.blocked_at IS NULL) OR pl.id IS NOT NULL)
      ORDER BY o.created_at LIMIT ?2`)
    .bind(MAX_ATTEMPTS, limit)
    .all<Row>();
  const tally = { sent: 0, dropped: 0, failed: 0 };
  const finish = (id: string, error: string | null) =>
    db
      .prepare("UPDATE email_outbox SET sent_at = ?2, last_error = ?3, payload = json_remove(payload, '$.token') WHERE id = ?1")
      .bind(id, now.toISOString(), error)
      .run();

  for (const row of results) {
    const claim = await db
      .prepare("UPDATE email_outbox SET attempts = attempts + 1 WHERE id = ?1 AND sent_at IS NULL AND attempts = ?2")
      .bind(row.id, row.attempts)
      .run();
    if (!claim.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payload) as Payload;
      const facts = await loadFacts(db, row, payload, deps.siteUrl.replace(/\/$/, ""));
      if (!facts) {
        await finish(row.id, "dropped: no longer relevant");
        tally.dropped++;
        continue;
      }
      const to = row.placeEmail ?? (row.authUserId ? await deps.lookupEmail(row.authUserId) : null);
      if (!to) {
        await finish(row.id, "dropped: no address");
        tally.dropped++;
        continue;
      }
      await deps.send({ to, ...renderEmail(row.template, facts) });
      await finish(row.id, null);
      tally.sent++;
    } catch (error) {
      await db
        .prepare("UPDATE email_outbox SET last_error = ?2 WHERE id = ?1")
        .bind(row.id, (error instanceof Error ? error.message : "Unknown error").slice(0, 300))
        .run();
      tally.failed++;
    }
  }
  return tally;
}

async function venueFacts(db: D1Database, row: Row, payload: Payload, siteUrl: string): Promise<EmailFacts | null> {
  const g = await db
    .prepare(`SELECT g.status, g.place_id AS placeId, a.id AS activityId, a.title, a.outcome, a.max_people AS maxPeople,
        s.starts_at AS startsAt, s.ends_at AS endsAt,
        (SELECT count(*) FROM attendance at WHERE at.gathering_id = g.id AND at.status = 'going') AS going
      FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id WHERE g.id = ?1`)
    .bind(payload.gatheringId ?? "")
    .first<{ status: string; placeId: string | null; activityId: string; title: string; outcome: string; maxPeople: number; startsAt: string; endsAt: string; going: number }>();
  if (!g) return null;
  if (row.template === "venue_request") {
    const pending = await db
      .prepare("SELECT 1 AS ok FROM venue_request WHERE token_hash = ?1 AND response IS NULL")
      .bind(await hashSecret(payload.token ?? ""))
      .first();
    if (!pending || g.status !== "awaiting_place") return null;
  }
  if (row.template === "venue_auto_booked" && !["awaiting_place", "scheduled"].includes(g.status)) return null;
  return {
    siteUrl,
    title: g.title,
    outcome: g.outcome,
    activityId: g.activityId,
    gatheringId: payload.gatheringId,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    going: g.going,
    maxPeople: g.maxPeople,
    token: payload.token,
    deadlineAt: payload.deadlineAt,
  };
}

/** NTF-01: queues one reminder per person going, the day before a booked gathering. */
export async function queueReminders(db: D1Database, now = new Date(), settings = DEFAULT_SETTINGS): Promise<number> {
  const until = new Date(now.getTime() + settings.reminder_hours_before * 60 * 60 * 1000);
  const { results } = await db
    .prepare(`SELECT g.id FROM gathering g JOIN slot s ON s.id = g.slot_id
      WHERE g.status = 'scheduled' AND s.starts_at > ?1 AND s.starts_at <= ?2
        AND NOT EXISTS (SELECT 1 FROM email_outbox o WHERE o.template = 'reminder'
          AND json_extract(o.payload, '$.gatheringId') = g.id)`)
    .bind(now.toISOString(), until.toISOString())
    .all<{ id: string }>();
  for (const g of results) {
    await queueToPeople(db, "reminder", { gatheringId: g.id }, GOING_SQL(1), [g.id]).run();
  }
  return results.length;
}
