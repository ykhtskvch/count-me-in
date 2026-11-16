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
  "reminder", // NTF-01: the day before
  "venue_request", // PLC-03: to a venue, approve or decline by link, no account
  "venue_auto_booked", // PLC-05: to a venue, a standing window was used
  "venue_cancelled", // to a venue that had approved, the gathering is off
  "card_published", // CAT-03: your suggested card is in the catalogue
  "card_rejected", // MOD-01: your suggested card was not published, and why
  "followup", // GAT-07: the morning after, two questions
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

/** Queues one email to a place's booking address, if `conditionSql` (using ?1..?N) holds. */
export function queueToPlace(
  db: D1Database,
  template: Template,
  payload: Record<string, unknown>,
  placeId: string,
  conditionSql = "1",
  params: Value[] = [],
): D1PreparedStatement {
  const n = params.length;
  return db
    .prepare(`INSERT INTO email_outbox (id, place_id, template, payload)
      SELECT lower(hex(randomblob(16))), pl.id, '${template}', ?${n + 2}
      FROM place pl WHERE pl.id = ?${n + 1} AND pl.booking_email IS NOT NULL AND (${conditionSql})`)
    .bind(...params, placeId, JSON.stringify(payload));
}
