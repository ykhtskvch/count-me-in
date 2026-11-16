// Reports and blocking (backlog 8.5–8.7, PRD MOD-03, MOD-04, MOD-06).
// A report is one button and an optional note. Only moderators see reports; the person
// reported is never told who reported them.
import { hideCard } from "./cards.ts";
import { leaveGathering } from "./gatherings.ts";

export type ReportTarget = { kind: "activity"; id: string } | { kind: "person"; id: string };

/** MOD-03. A second report on the same thing by the same person updates the first. */
export async function createReport(db: D1Database, reporterId: string, target: ReportTarget, text: string): Promise<void> {
  const note = text.trim().slice(0, 1000);
  const existing = await db
    .prepare(`SELECT id FROM report WHERE reporter_id = ?1 AND target_kind = ?2 AND target_id = ?3 AND resolved_at IS NULL`)
    .bind(reporterId, target.kind, target.id)
    .first<{ id: string }>();
  if (existing) {
    await db.prepare("UPDATE report SET text = ?2 WHERE id = ?1").bind(existing.id, note).run();
    return;
  }
  await db
    .prepare("INSERT INTO report (id, reporter_id, target_kind, target_id, text) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(crypto.randomUUID(), reporterId, target.kind, target.id, note)
    .run();
}

/** The host is the only other person a participant ever sees, so the host is who can be reported. */
export async function hostOf(db: D1Database, gatheringId: string, viewerId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT g.host_person_id AS hostId FROM gathering g
      JOIN attendance at ON at.gathering_id = g.id AND at.person_id = ?2
      WHERE g.id = ?1 AND g.host_person_id IS NOT NULL AND g.host_person_id <> ?2`)
    .bind(gatheringId, viewerId)
    .first<{ hostId: string }>();
  return row?.hostId ?? null;
}

export type OpenReport = {
  targetKind: "activity" | "person";
  targetId: string;
  label: string;
  count: number;
  notes: string[];
  firstAt: string;
};

/** Unresolved reports grouped by what they are about, most reported first. */
export async function openReports(db: D1Database): Promise<OpenReport[]> {
  const { results } = await db
    .prepare(`SELECT r.target_kind AS targetKind, r.target_id AS targetId, r.text, r.created_at AS createdAt,
        CASE r.target_kind WHEN 'activity' THEN (SELECT title FROM activity WHERE id = r.target_id)
          ELSE (SELECT display_name FROM person WHERE id = r.target_id) END AS label
      FROM report r WHERE r.resolved_at IS NULL ORDER BY r.created_at`)
    .all<{ targetKind: "activity" | "person"; targetId: string; text: string; createdAt: string; label: string | null }>();
  const groups = new Map<string, OpenReport>();
  for (const r of results) {
    const key = `${r.targetKind}:${r.targetId}`;
    const g = groups.get(key) ?? { targetKind: r.targetKind, targetId: r.targetId, label: r.label ?? "(deleted)", count: 0, notes: [], firstAt: r.createdAt };
    g.count++;
    if (r.text) g.notes.push(r.text);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.firstAt.localeCompare(b.firstAt));
}

/**
 * MOD-04: blocks an account. The person is signed out, stops counting anywhere and
 * leaves any gathering they were going to (hosting passes on). Moderators can't be blocked here.
 */
export async function blockPerson(db: D1Database, actorId: string, personId: string, note: string | null, now = new Date()): Promise<boolean> {
  const person = await db
    .prepare("SELECT auth_user_id AS authUserId, role, blocked_at AS blockedAt FROM person WHERE id = ?1")
    .bind(personId)
    .first<{ authUserId: string; role: string; blockedAt: string | null }>();
  if (!person || person.role === "moderator" || person.blockedAt) return false;
  const { results: going } = await db
    .prepare(`SELECT at.gathering_id AS id FROM attendance at JOIN gathering g ON g.id = at.gathering_id
      WHERE at.person_id = ?1 AND at.status = 'going' AND g.status IN ('awaiting_place', 'scheduled')`)
    .bind(personId)
    .all<{ id: string }>();
  for (const g of going) await leaveGathering(db, g.id, personId, now);
  await db.batch([
    db.prepare("UPDATE person SET blocked_at = ?2 WHERE id = ?1").bind(personId, now.toISOString()),
    db.prepare("DELETE FROM session WHERE auth_user_id = ?1").bind(person.authUserId),
    db.prepare(`DELETE FROM slot_vote WHERE person_id = ?1 AND slot_id IN (SELECT id FROM slot WHERE status = 'open')`).bind(personId),
    db
      .prepare(`INSERT INTO mod_action (id, actor_id, action, target_kind, target_id, reason)
        VALUES (?1, ?2, 'block_person', 'person', ?3, ?4)`)
      .bind(crypto.randomUUID(), actorId, personId, note),
  ]);
  return true;
}

/** Closes every open report on a target, after dismissing it, hiding the card or blocking the person. */
export async function resolveReports(
  db: D1Database,
  actorId: string,
  target: ReportTarget,
  action: "dismiss" | "hide" | "block",
  note: string | null,
  now = new Date(),
): Promise<boolean> {
  if (action === "hide" && target.kind === "activity") await hideCard(db, actorId, target.id, note);
  else if (action === "block" && target.kind === "person") {
    if (!(await blockPerson(db, actorId, target.id, note, now))) return false;
  } else if (action !== "dismiss") return false;
  await db.batch([
    db
      .prepare("UPDATE report SET resolved_at = ?3 WHERE target_kind = ?1 AND target_id = ?2 AND resolved_at IS NULL")
      .bind(target.kind, target.id, now.toISOString()),
    db
      .prepare(`INSERT INTO mod_action (id, actor_id, action, target_kind, target_id, reason)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(crypto.randomUUID(), actorId, `resolve_reports_${action}`, target.kind, target.id, note),
  ]);
  return true;
}
