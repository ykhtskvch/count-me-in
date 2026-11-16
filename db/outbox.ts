// Queues emails in `email_outbox` (epic 7). Each helper returns a statement, so the
// email is queued in the same batch, and so the same transaction, as the change it reports.
// Sending through SES happens later, from the scheduler.

export const TEMPLATES = [
  "round_opened", // NTF: enough people, pick the evenings you can make
  "round_failed", // TIME-04: not enough people for any evening; interest is kept
  "host_offer", // GAT-02: would you greet everyone? accept or decline by link
  "gathering_scheduled", // GAT-01: date, place, host, what to bring
  "below_minimum", // GAT-05: fewer than the minimum now; you decide whether to go
  "gathering_cancelled", // no host, or a moderator cancelled
] as const;

export type Template = (typeof TEMPLATES)[number];

type Value = string | number | null;

/**
 * Queues one email per person returned by `peopleSql`, which selects a `person_id`
 * column and uses parameters ?1..?N from `params`. Blocked people are skipped.
 */
export function queueToPeople(
  db: D1Database,
  template: Template,
  payload: Record<string, unknown>,
  peopleSql: string,
  params: Value[] = [],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO email_outbox (id, person_id, template, payload)
      SELECT lower(hex(randomblob(16))), q.person_id, '${template}', ?${params.length + 1}
      FROM (${peopleSql}) q JOIN person p ON p.id = q.person_id AND p.blocked_at IS NULL`)
    .bind(...params, JSON.stringify(payload));
}

/** Everyone currently going to a gathering. */
export const GOING_SQL = (param: number) =>
  `SELECT person_id FROM attendance WHERE gathering_id = ?${param} AND status = 'going'`;

/** Everyone interested in a card. */
export const INTERESTED_SQL = (param: number) => `SELECT person_id FROM interest WHERE activity_id = ?${param}`;
