// GAT-07: after a gathering, one email with two questions: did it happen, and would you
// come again? Sent the morning after (followup_hour, London time; an assumption).
// "Yes, again" puts the person back on the card's interest list, so the next round counts them.
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { londonParts } from "../lib/slots.ts";
import { queueToPeople } from "./outbox.ts";
import { createToken, hashSecret } from "./runtime.ts";

/** London hour (0–23) of an instant. */
function londonHour(at: Date): number {
  return new Date(at.getTime() + londonParts(at).offsetMin * 60000).getUTCHours();
}

/** Scheduler: queues the follow-up for gatherings that ended on an earlier London day. */
export async function queueFollowups(db: D1Database, now = new Date(), settings = DEFAULT_SETTINGS): Promise<number> {
  if (londonHour(now) < settings.followup_hour) return 0;
  const today = londonParts(now).date;
  const { results } = await db
    .prepare(`SELECT g.id, s.ends_at AS endsAt FROM gathering g JOIN slot s ON s.id = g.slot_id
      WHERE g.status = 'happened' AND s.ends_at > ?1
        AND NOT EXISTS (SELECT 1 FROM followup f WHERE f.gathering_id = g.id)`)
    // Nothing older than a week is chased.
    .bind(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .all<{ id: string; endsAt: string }>();
  let queued = 0;
  for (const g of results) {
    if (londonParts(new Date(g.endsAt)).date >= today) continue;
    const { results: people } = await db
      .prepare(`SELECT at.person_id AS personId FROM attendance at JOIN person p ON p.id = at.person_id
        WHERE at.gathering_id = ?1 AND at.status = 'going' AND p.blocked_at IS NULL`)
      .bind(g.id)
      .all<{ personId: string }>();
    for (const { personId } of people) {
      const token = createToken();
      await db.batch([
        db
          .prepare("INSERT INTO followup (gathering_id, person_id, token_hash) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING")
          .bind(g.id, personId, await hashSecret(token)),
        queueToPeople(db, "followup", { gatheringId: g.id, token }, "SELECT ?1 AS person_id", [personId]),
      ]);
    }
    if (people.length) queued++;
  }
  return queued;
}

export type FollowupView = { title: string; startsAt: string; endsAt: string; answered: boolean };

async function find(db: D1Database, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return db
    .prepare(`SELECT f.gathering_id AS gatheringId, f.person_id AS personId, f.answered_at AS answeredAt,
        a.id AS activityId, a.title, s.starts_at AS startsAt, s.ends_at AS endsAt
      FROM followup f JOIN gathering g ON g.id = f.gathering_id JOIN slot s ON s.id = g.slot_id
      JOIN round r ON r.id = g.round_id JOIN activity a ON a.id = r.activity_id
      WHERE f.token_hash = ?1`)
    .bind(await hashSecret(token))
    .first<{ gatheringId: string; personId: string; answeredAt: string | null; activityId: string; title: string; startsAt: string; endsAt: string }>();
}

export async function viewFollowup(db: D1Database, token: string): Promise<FollowupView | null> {
  const f = await find(db, token);
  return f ? { title: f.title, startsAt: f.startsAt, endsAt: f.endsAt, answered: f.answeredAt !== null } : null;
}

/** Records the two answers, once. "Again" counts the person in on the card if it is taking interest. */
export async function answerFollowup(
  db: D1Database,
  token: string,
  answers: { happened: boolean; again: boolean },
  now = new Date(),
): Promise<"saved" | "already" | "invalid"> {
  const f = await find(db, token);
  if (!f) return "invalid";
  if (f.answeredAt) return "already";
  const [saved] = await db.batch([
    db
      .prepare(`UPDATE followup SET happened = ?3, again = ?4, answered_at = ?5
        WHERE gathering_id = ?1 AND person_id = ?2 AND answered_at IS NULL`)
      .bind(f.gatheringId, f.personId, answers.happened ? 1 : 0, answers.again ? 1 : 0, now.toISOString()),
    ...(answers.again
      ? [
          db
            .prepare(`INSERT INTO interest (person_id, activity_id)
              SELECT ?1, id FROM activity WHERE id = ?2 AND state IN ('in_catalogue', 'choosing')
              ON CONFLICT(person_id, activity_id) DO NOTHING`)
            .bind(f.personId, f.activityId),
        ]
      : []),
  ]);
  return saved.meta.changes ? "saved" : "already";
}
