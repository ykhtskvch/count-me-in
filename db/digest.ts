// The weekly email about new activities (backlog P1, PRD NTF-04).
//
// Off unless the person turns it on in /settings. Queued on one weekday morning, only
// for people who have something new to read, and never more often than once a week:
// the time of the last one is kept next to the preference. The list itself is built when
// the email is sent, so it never names a card that has been removed since.
//
// "New" means published in the last seven days, still open, not suggested by the person
// and not one they are already in. Cards with interest from the person's own district
// come first.
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { londonParts } from "../lib/slots.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Not before this hour in London, so nobody is emailed at midnight. */
const DIGEST_HOUR = 8;

const NEW_FOR = (person: string, since: string) => `a.published_at > ${since} AND a.state IN ('in_catalogue', 'choosing')
  AND (a.author_id IS NULL OR a.author_id <> ${person})
  AND NOT EXISTS (SELECT 1 FROM interest i WHERE i.activity_id = a.id AND i.person_id = ${person})`;

export type DigestItem = { id: string; title: string; outcome: string };

/** The cards one person's weekly email lists; empty if they switched it off. */
export async function digestItems(db: D1Database, personId: string, since: string, limit = 8): Promise<DigestItem[]> {
  const { results } = await db
    .prepare(`SELECT a.id, a.title, a.outcome FROM activity a JOIN person p ON p.id = ?1
      WHERE json_extract(p.email_prefs, '$.digest') = 1 AND ${NEW_FOR("p.id", "?2")}
      ORDER BY (SELECT count(*) FROM interest i JOIN person o ON o.id = i.person_id
          WHERE i.activity_id = a.id AND o.postcode_district = p.postcode_district) DESC,
        a.published_at DESC
      LIMIT ?3`)
    .bind(personId, since, limit)
    .all<DigestItem>();
  return results.map((r) => ({ ...r }));
}

/** Scheduler, NTF-04: queues this week's email for everyone who asked and has something new. */
export async function queueDigests(db: D1Database, now = new Date(), settings = DEFAULT_SETTINGS): Promise<number> {
  const london = londonParts(now);
  const hour = new Date(now.getTime() + london.offsetMin * 60000).getUTCHours();
  if (london.weekday !== settings.digest_weekday || hour < DIGEST_HOUR) return 0;

  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  // Six days, not seven, so a run a few minutes earlier than last week's still counts.
  const notSince = new Date(now.getTime() - 6 * DAY_MS).toISOString();
  const due = `json_extract(p.email_prefs, '$.digest') = 1 AND p.blocked_at IS NULL
    AND coalesce(json_extract(p.email_prefs, '$.digestAt'), '') < ?2
    AND EXISTS (SELECT 1 FROM activity a WHERE ${NEW_FOR("p.id", "?1")})`;
  const [queued] = await db.batch([
    db
      .prepare(`INSERT INTO email_outbox (id, person_id, template, payload)
        SELECT lower(hex(randomblob(16))), p.id, 'digest', ?3 FROM person p WHERE ${due}`)
      .bind(since, notSince, JSON.stringify({ since })),
    db
      .prepare(`UPDATE person AS p SET email_prefs = json_set(email_prefs, '$.digestAt', ?3) WHERE ${due}`)
      .bind(since, notSince, now.toISOString()),
  ]);
  return queued.meta.changes;
}
