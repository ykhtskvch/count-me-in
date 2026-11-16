// The PRD's metrics, counted from what the platform already stores (backlog 10.x).
// Nothing is tracked about visits or time on the site: the aim is that people meet.
export type Metrics = {
  gatheringsHappened: number;
  /** Cards that ever reached their minimum, out of all cards that were published. */
  cardsReachedMinimum: { reached: number; published: number };
  /** Rounds of picking evenings that ended in a gathering. */
  roundsWon: { won: number; closed: number };
  venueRequests: { approved: number; answeredOrExpired: number };
  /** People who went to a gathering that happened more than once. */
  peopleCameBack: number;
  cardsSuggestedByParticipants: number;
  /** Happened gatherings with no moderator among the people going (the PRD's "without the project owner"). */
  happenedWithoutModerator: number;
};

const n = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;

export async function computeMetrics(db: D1Database): Promise<Metrics> {
  return {
    gatheringsHappened: await n(db, "SELECT count(*) AS n FROM gathering WHERE status = 'happened'"),
    cardsReachedMinimum: {
      reached: await n(db, "SELECT count(DISTINCT activity_id) AS n FROM round"),
      published: await n(db, "SELECT count(*) AS n FROM activity WHERE state <> 'in_review' AND rejection_reason IS NULL"),
    },
    roundsWon: {
      won: await n(db, "SELECT count(*) AS n FROM round WHERE outcome = 'won'"),
      closed: await n(db, "SELECT count(*) AS n FROM round WHERE outcome <> 'open'"),
    },
    venueRequests: {
      approved: await n(db, "SELECT count(*) AS n FROM venue_request WHERE response = 'approved'"),
      answeredOrExpired: await n(db, "SELECT count(*) AS n FROM venue_request WHERE response IS NOT NULL"),
    },
    peopleCameBack: await n(
      db,
      `SELECT count(*) AS n FROM (SELECT at.person_id FROM attendance at JOIN gathering g ON g.id = at.gathering_id
        WHERE g.status = 'happened' AND at.status = 'going' GROUP BY at.person_id HAVING count(*) >= 2)`,
    ),
    cardsSuggestedByParticipants: await n(
      db,
      `SELECT count(*) AS n FROM activity a JOIN person p ON p.id = a.author_id WHERE p.role = 'participant'`,
    ),
    happenedWithoutModerator: await n(
      db,
      `SELECT count(*) AS n FROM gathering g WHERE g.status = 'happened' AND NOT EXISTS (
        SELECT 1 FROM attendance at JOIN person p ON p.id = at.person_id
        WHERE at.gathering_id = g.id AND at.status = 'going' AND p.role = 'moderator')`,
    ),
  };
}
