// The person's own settings and deleting the account (backlog 9.x, PRD ACC-04, NTF-03,
// INT-03). Deleting removes everything the platform holds about the person; the email
// address itself is deleted from Supabase Auth by the route.
import { leaveGathering } from "./gatherings.ts";

export async function updateSettings(db: D1Database, personId: string, settings: { showName: boolean }): Promise<void> {
  await db.prepare("UPDATE person SET show_name = ?2 WHERE id = ?1").bind(personId, settings.showName ? 1 : 0).run();
}

/**
 * ACC-04: leaves live gatherings first (so hosting passes on and others are told if it
 * drops below the minimum), then deletes the person. Interest, ticks, attendance, offers
 * and queued emails go with them; cards they suggested stay, without an author.
 */
export async function deleteAccount(db: D1Database, personId: string, now = new Date()): Promise<{ authUserId: string } | null> {
  const person = await db
    .prepare("SELECT auth_user_id AS authUserId, role FROM person WHERE id = ?1")
    .bind(personId)
    .first<{ authUserId: string; role: string }>();
  // A moderator's actions stay in the log, so a moderator is first made a participant by another moderator.
  if (!person || person.role === "moderator") return null;
  const { results: going } = await db
    .prepare(`SELECT at.gathering_id AS id FROM attendance at JOIN gathering g ON g.id = at.gathering_id
      WHERE at.person_id = ?1 AND at.status = 'going' AND g.status IN ('awaiting_place', 'scheduled')`)
    .bind(personId)
    .all<{ id: string }>();
  for (const g of going) await leaveGathering(db, g.id, personId, now);
  await db.batch([
    // A past gathering they hosted keeps its record without them.
    db.prepare("UPDATE gathering SET host_person_id = NULL WHERE host_person_id = ?1 AND status IN ('happened', 'cancelled')").bind(personId),
    db.prepare("DELETE FROM session WHERE auth_user_id = ?1").bind(person.authUserId),
    db.prepare("DELETE FROM person WHERE id = ?1").bind(personId),
  ]);
  return { authUserId: person.authUserId };
}
