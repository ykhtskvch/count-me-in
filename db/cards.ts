// Suggesting cards and the moderator's review queue (backlog 8.1–8.3, PRD CAT-03, CAT-05,
// MOD-01, MOD-02, MOD-04, MOD-06). Every moderator action is written to mod_action.
import { type CardInput } from "../lib/card-input.ts";
import { REJECTION_REASONS, type RejectionReason } from "../lib/card-input.ts";
import { canTransition, nextState, type CardState } from "../lib/card-state.ts";
import { cancelGathering } from "./gatherings.ts";
import { queueToPeople } from "./outbox.ts";

const log = (db: D1Database, actorId: string, action: string, targetId: string, reason: string | null = null) =>
  db
    .prepare(`INSERT INTO mod_action (id, actor_id, action, target_kind, target_id, reason)
      VALUES (?1, ?2, ?3, 'activity', ?4, ?5)`)
    .bind(crypto.randomUUID(), actorId, action, targetId, reason);

const fieldValues = (c: CardInput) => [
  c.title, c.outcome, c.minPeople, c.maxPeople, c.durationMin, c.bring, c.materialsCostPence, c.placeKind,
  c.needsKnower ? 1 : 0, c.season, c.instructions,
];

/**
 * CAT-03: anyone signed in suggests a card; it waits for review. A moderator's own card
 * is published straight away, which is how the starter set gets in (CAT-05).
 */
export async function suggestCard(db: D1Database, author: { id: string; role: string }, card: CardInput): Promise<string> {
  const id = crypto.randomUUID();
  const moderator = author.role === "moderator";
  const state: CardState = moderator ? nextState("in_review", "published") : "in_review";
  const statements = [
    db
      .prepare(`INSERT INTO activity (id, title, outcome, min_people, max_people, duration_min, bring, materials_cost_pence,
          place_kind, needs_knower, season, instructions, state, author_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(id, ...fieldValues(card), state, author.id),
  ];
  if (moderator) statements.push(log(db, author.id, "publish_card", id));
  await db.batch(statements);
  return id;
}

export type ReviewItem = CardInput & { id: string; createdAt: string; authorName: string | null };

/** MOD-01: cards waiting for review, oldest first. */
export async function reviewQueue(db: D1Database): Promise<ReviewItem[]> {
  const { results } = await db
    .prepare(`SELECT a.id, a.title, a.outcome, a.min_people AS minPeople, a.max_people AS maxPeople,
        a.duration_min AS durationMin, a.bring, a.materials_cost_pence AS materialsCostPence, a.place_kind AS placeKind,
        a.needs_knower AS needsKnower, a.season, a.instructions, a.created_at AS createdAt, p.display_name AS authorName
      FROM activity a LEFT JOIN person p ON p.id = a.author_id
      WHERE a.state = 'in_review' ORDER BY a.created_at`)
    .all<Omit<ReviewItem, "needsKnower"> & { needsKnower: number }>();
  return results.map((r) => ({ ...r, needsKnower: Boolean(r.needsKnower) }));
}

/** MOD-01: publish a card, optionally with the moderator's corrections. */
export async function publishCard(db: D1Database, actorId: string, id: string, edits: CardInput | null = null): Promise<boolean> {
  const statements: D1PreparedStatement[] = [
    queueToPeople(db, "card_published", { activityId: id }, `SELECT author_id AS person_id FROM activity WHERE id = ?1
      AND state = 'in_review' AND author_id IS NOT NULL`, [id]),
  ];
  if (edits) {
    statements.push(
      db
        .prepare(`UPDATE activity SET title = ?2, outcome = ?3, min_people = ?4, max_people = ?5, duration_min = ?6, bring = ?7,
            materials_cost_pence = ?8, place_kind = ?9, needs_knower = ?10, season = ?11, instructions = ?12
          WHERE id = ?1 AND state = 'in_review'`)
        .bind(id, ...fieldValues(edits)),
    );
  }
  const publish = db
    .prepare("UPDATE activity SET state = ?2 WHERE id = ?1 AND state = 'in_review'")
    .bind(id, nextState("in_review", "published"));
  statements.push(publish, log(db, actorId, edits ? "edit_and_publish_card" : "publish_card", id));
  const results = await db.batch(statements);
  return results[statements.indexOf(publish)].meta.changes > 0;
}

/** MOD-01/MOD-02: reject with one of the set reasons, which the author is told. */
export async function rejectCard(db: D1Database, actorId: string, id: string, reason: RejectionReason): Promise<boolean> {
  const text = REJECTION_REASONS[reason];
  const reject = db
    .prepare("UPDATE activity SET state = ?2, rejection_reason = ?3 WHERE id = ?1 AND state = 'in_review'")
    .bind(id, nextState("in_review", "rejected"), text);
  const results = await db.batch([
    queueToPeople(db, "card_rejected", { activityId: id, reason: text }, `SELECT author_id AS person_id FROM activity
      WHERE id = ?1 AND state = 'in_review' AND author_id IS NOT NULL`, [id]),
    reject,
    log(db, actorId, "reject_card", id, reason),
  ]);
  return results[1].meta.changes > 0;
}

/**
 * MOD-04: hide a live card. A gathering it has is cancelled (everyone going is told),
 * and an open round simply closes.
 */
export async function hideCard(db: D1Database, actorId: string, id: string, note: string | null): Promise<boolean> {
  const card = await db.prepare("SELECT state FROM activity WHERE id = ?1").bind(id).first<{ state: CardState }>();
  if (!card || !canTransition(card.state, "removed")) return false;
  const { results: live } = await db
    .prepare(`SELECT g.id FROM gathering g JOIN round r ON r.id = g.round_id
      WHERE r.activity_id = ?1 AND g.status IN ('awaiting_place', 'scheduled')`)
    .bind(id)
    .all<{ id: string }>();
  for (const g of live) await cancelGathering(db, g.id, "moderator", actorId, note);
  const results = await db.batch([
    db.prepare("UPDATE round SET outcome = 'failed' WHERE activity_id = ?1 AND outcome = 'open'").bind(id),
    db.prepare(`UPDATE slot SET status = 'closed' WHERE status = 'open'
      AND round_id IN (SELECT id FROM round WHERE activity_id = ?1)`).bind(id),
    db.prepare("UPDATE activity SET state = 'removed' WHERE id = ?1 AND state <> 'removed'").bind(id),
    log(db, actorId, "hide_card", id, note),
  ]);
  return results[2].meta.changes > 0;
}
