// Picking evenings (backlog 4.1–4.4, PRD TIME-01..TIME-05).
//
// A round opens when a card in the catalogue reaches its minimum. People tick every
// slot they can make; the first slot to reach the minimum wins (TIME-03), and the
// database's unique index on won slots makes sure two simultaneous votes cannot
// produce two gatherings. A round that reaches its closing time without a winner
// fails and the card goes back to the catalogue with its interest kept (TIME-04).
//
// Every multi-step change is one D1 batch, which runs as a single transaction.
import { nextState } from "../lib/card-state.ts";
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { type Window, proposeSlots, roundClosesAt } from "../lib/slots.ts";

const ACTIVE_PERSON = "JOIN person p ON p.id = v.person_id AND p.blocked_at IS NULL";

export type SlotView = { id: string; startsAt: string; endsAt: string; canMake: number; mine: boolean };
export type RoundView = { id: string; closesAt: string; slots: SlotView[] };

/** TIME-01: opens a round if the card has just reached its minimum. Returns the round id or null. */
export async function openRoundIfReady(
  db: D1Database,
  activityId: string,
  now = new Date(),
  settings = DEFAULT_SETTINGS,
): Promise<string | null> {
  const card = await db
    .prepare(`SELECT a.state, a.min_people AS minPeople, a.duration_min AS durationMin, a.place_kind AS placeKind
      FROM activity a WHERE a.id = ?1`)
    .bind(activityId)
    .first<{ state: string; minPeople: number; durationMin: number; placeKind: "venue" | "public" }>();
  if (!card || card.state !== "in_catalogue") return null;

  const { results: interests } = await db
    .prepare(`SELECT i.times FROM interest i JOIN person p ON p.id = i.person_id
      WHERE i.activity_id = ?1 AND p.blocked_at IS NULL`)
    .bind(activityId)
    .all<{ times: string }>();
  if (interests.length < card.minPeople) return null;

  let windows: Window[] | undefined;
  if (card.placeKind === "venue") {
    const { results } = await db
      .prepare(`SELECT w.weekday, w.start_time AS startTime, w.end_time AS endTime
        FROM place_window w JOIN place pl ON pl.id = w.place_id
        WHERE pl.active = 1 AND pl.kind = 'venue'`)
      .all<Window>();
    windows = results;
  }

  const slots = proposeSlots({
    now,
    durationMin: card.durationMin,
    interestTimes: interests.map((i) => parseTimes(i.times)),
    windows,
    settings,
  });
  if (slots.length === 0) return null;

  const roundId = crypto.randomUUID();
  const to = nextState("in_catalogue", "threshold_reached");
  try {
    const [opened] = await db.batch([
      db
        .prepare(`INSERT INTO round (id, activity_id, opened_at, closes_at)
          SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM activity WHERE id = ?2 AND state = 'in_catalogue')`)
        .bind(roundId, activityId, now.toISOString(), roundClosesAt(slots, settings)),
      ...slots.map((slot) =>
        db
          .prepare(`INSERT INTO slot (id, round_id, starts_at, ends_at)
            SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM round WHERE id = ?2)`)
          .bind(crypto.randomUUID(), roundId, slot.startsAt, slot.endsAt),
      ),
      db
        .prepare(`UPDATE activity SET state = ?2
          WHERE id = ?1 AND state = 'in_catalogue' AND EXISTS (SELECT 1 FROM round WHERE id = ?3)`)
        .bind(activityId, to, roundId),
    ]);
    return opened.meta.changes ? roundId : null;
  } catch {
    // Someone else opened the round at the same moment (unique index round_one_open).
    return null;
  }
}

/** TIME-02: the open round's slots with a count for each, and which ones the viewer ticked. */
export async function getOpenRound(db: D1Database, activityId: string, personId: string | null): Promise<RoundView | null> {
  const round = await db
    .prepare("SELECT id, closes_at AS closesAt FROM round WHERE activity_id = ?1 AND outcome = 'open'")
    .bind(activityId)
    .first<{ id: string; closesAt: string }>();
  if (!round) return null;
  const { results } = await db
    .prepare(`SELECT s.id, s.starts_at AS startsAt, s.ends_at AS endsAt,
        (SELECT count(*) FROM slot_vote v ${ACTIVE_PERSON} WHERE v.slot_id = s.id) AS canMake,
        EXISTS (SELECT 1 FROM slot_vote v WHERE v.slot_id = s.id AND v.person_id = ?2) AS mine
      FROM slot s WHERE s.round_id = ?1 AND s.status = 'open' ORDER BY s.starts_at`)
    .bind(round.id, personId ?? "")
    .all<Omit<SlotView, "mine"> & { mine: number }>();
  return { ...round, slots: results.map((s) => ({ ...s, mine: Boolean(s.mine) })) };
}

export type VoteResult = { ok: true; gatheringId: string | null } | { ok: false; reason: "closed" };

/**
 * TIME-02/TIME-03: "I can make it" on a slot, or taking it back. Ticking a slot also
 * counts the person in on the card. Returns the new gathering's id if this vote won.
 */
export async function voteSlot(
  db: D1Database,
  slotId: string,
  personId: string,
  canMake: boolean,
  now = new Date(),
): Promise<VoteResult> {
  const open = `FROM slot s JOIN round r ON r.id = s.round_id
    WHERE s.id = ?1 AND s.status = 'open' AND r.outcome = 'open' AND r.closes_at > ?3`;
  if (!canMake) {
    const result = await db
      .prepare(`DELETE FROM slot_vote WHERE slot_id = ?1 AND person_id = ?2 AND EXISTS (SELECT 1 ${open})`)
      .bind(slotId, personId, now.toISOString())
      .run();
    if (!result.meta.changes && !(await isOpen(db, slotId, now))) return { ok: false, reason: "closed" };
    return { ok: true, gatheringId: null };
  }

  const [, voted] = await db.batch([
    db
      .prepare(`INSERT INTO interest (person_id, activity_id) SELECT ?2, r.activity_id ${open}
        ON CONFLICT(person_id, activity_id) DO NOTHING`)
      .bind(slotId, personId, now.toISOString()),
    db
      .prepare(`INSERT INTO slot_vote (slot_id, person_id) SELECT ?1, ?2 ${open}
        ON CONFLICT(slot_id, person_id) DO NOTHING`)
      .bind(slotId, personId, now.toISOString()),
  ]);
  if (!voted.meta.changes && !(await isOpen(db, slotId, now))) return { ok: false, reason: "closed" };
  return { ok: true, gatheringId: await tryWin(db, slotId) };
}

async function isOpen(db: D1Database, slotId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM slot s JOIN round r ON r.id = s.round_id
      WHERE s.id = ?1 AND s.status = 'open' AND r.outcome = 'open' AND r.closes_at > ?2`)
    .bind(slotId, now.toISOString())
    .first<{ ok: number }>();
  return Boolean(row);
}

/**
 * TIME-03: if the slot has reached the card's minimum, it becomes the gathering and the
 * other slots close. Up to max_people of the slot's voters, earliest first, are going;
 * everyone else interested waits in the queue for next time (TIME-05).
 */
async function tryWin(db: D1Database, slotId: string): Promise<string | null> {
  const info = await db
    .prepare(`SELECT s.round_id AS roundId, r.activity_id AS activityId, a.min_people AS minPeople,
        a.max_people AS maxPeople, a.place_kind AS placeKind,
        (SELECT count(*) FROM slot_vote v ${ACTIVE_PERSON} WHERE v.slot_id = s.id) AS canMake
      FROM slot s JOIN round r ON r.id = s.round_id JOIN activity a ON a.id = r.activity_id
      WHERE s.id = ?1 AND s.status = 'open' AND r.outcome = 'open'`)
    .bind(slotId)
    .first<{ roundId: string; activityId: string; minPeople: number; maxPeople: number; placeKind: string; canMake: number }>();
  if (!info || info.canMake < info.minPeople) return null;

  const gatheringId = crypto.randomUUID();
  const won = "EXISTS (SELECT 1 FROM gathering WHERE id = ?7)";
  // A venue card waits for its place; a public card stays in "choosing" until a host accepts.
  const cardState = info.placeKind === "venue" ? nextState("choosing", "slot_won_needs_venue") : "choosing";
  const values = [slotId, info.roundId, info.activityId, info.minPeople, info.maxPeople, cardState, gatheringId];
  // D1 wants exactly as many values as the highest ?N in the statement.
  const bind = (sql: string) =>
    db.prepare(sql).bind(...values.slice(0, Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])))));
  try {
    await db.batch([
      bind(`UPDATE slot SET status = 'won' WHERE id = ?1 AND status = 'open'
        AND (SELECT count(*) FROM slot_vote v ${ACTIVE_PERSON} WHERE v.slot_id = ?1) >= ?4`),
      bind(`INSERT INTO gathering (id, round_id, slot_id)
        SELECT ?7, ?2, ?1 WHERE EXISTS (SELECT 1 FROM slot WHERE id = ?1 AND status = 'won')`),
      bind(`UPDATE slot SET status = 'closed' WHERE round_id = ?2 AND id <> ?1 AND ${won}`),
      bind(`UPDATE round SET outcome = 'won' WHERE id = ?2 AND outcome = 'open' AND ${won}`),
      bind(`INSERT INTO attendance (gathering_id, person_id)
        SELECT ?7, v.person_id FROM slot_vote v ${ACTIVE_PERSON}
        WHERE v.slot_id = ?1 AND ${won} ORDER BY v.created_at, v.person_id LIMIT ?5`),
      bind(`UPDATE interest SET queued = 1 WHERE activity_id = ?3 AND ${won}
        AND person_id NOT IN (SELECT person_id FROM attendance WHERE gathering_id = ?7)`),
      bind(`UPDATE activity SET state = ?6 WHERE id = ?3 AND state = 'choosing' AND ${won}`),
    ]);
  } catch {
    // Another slot of this round won at the same moment (unique indexes slot_one_winner, gathering.round_id).
    return null;
  }
  const created = await db.prepare("SELECT id FROM gathering WHERE id = ?1").bind(gatheringId).first<{ id: string }>();
  return created ? gatheringId : null;
}

/**
 * TIME-04: closes rounds whose picking time is over without a winner. The card goes
 * back to the catalogue and keeps its interest. Run by the scheduler.
 */
export async function closeDueRounds(db: D1Database, now = new Date()): Promise<{ roundId: string; activityId: string }[]> {
  const { results } = await db
    .prepare("SELECT id AS roundId, activity_id AS activityId FROM round WHERE outcome = 'open' AND closes_at <= ?1")
    .bind(now.toISOString())
    .all<{ roundId: string; activityId: string }>();
  const back = nextState("choosing", "round_failed");
  const closed: { roundId: string; activityId: string }[] = [];
  for (const round of results) {
    const [failed] = await db.batch([
      db.prepare("UPDATE round SET outcome = 'failed' WHERE id = ?1 AND outcome = 'open'").bind(round.roundId),
      db.prepare("UPDATE slot SET status = 'closed' WHERE round_id = ?1 AND status = 'open'").bind(round.roundId),
      db.prepare("UPDATE activity SET state = ?2 WHERE id = ?1 AND state = 'choosing'").bind(round.activityId, back),
    ]);
    if (failed.meta.changes) closed.push(round);
  }
  return closed;
}

/** Taking interest back also takes back any ticks on that card's open slots. */
export async function removeOpenVotes(db: D1Database, activityId: string, personId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM slot_vote WHERE person_id = ?2 AND slot_id IN (
        SELECT s.id FROM slot s JOIN round r ON r.id = s.round_id
        WHERE r.activity_id = ?1 AND r.outcome = 'open' AND s.status = 'open')`)
    .bind(activityId, personId)
    .run();
}

function parseTimes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
