// Catalogue and interest queries. Other people's names never leave this file:
// the API returns counts only (INT-03).
import { type CatalogueItem, sortCatalogue, stillNeeded } from "../lib/catalogue.ts";

export const PUBLIC_STATES = ["in_catalogue", "choosing", "awaiting_place", "scheduled"] as const;

export type ActivitySummary = CatalogueItem & {
  outcome: string;
  durationMin: number;
  placeKind: "venue" | "public";
  state: string;
  stillNeeded: number;
  timesRun: number;
  mine: boolean;
};

export type ActivityDetail = ActivitySummary & {
  bring: string;
  materialsCostPence: number;
  needsKnower: boolean;
  season: string | null;
  myTimes: string[];
};

const SELECT = `SELECT a.id, a.title, a.outcome, a.min_people AS minPeople, a.max_people AS maxPeople,
    a.duration_min AS durationMin, a.place_kind AS placeKind, a.state, a.times_run AS timesRun,
    a.bring, a.materials_cost_pence AS materialsCostPence, a.needs_knower AS needsKnower, a.season,
    a.created_at AS createdAt, a.last_interest_at AS lastInterestAt,
    (SELECT count(*) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL) AS interested,
    (SELECT count(*) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL AND p.postcode_district = ?1) AS interestedNearby,
    (SELECT i.times FROM interest i WHERE i.activity_id = a.id AND i.person_id = ?2) AS myTimesJson
  FROM activity a`;

type Row = Omit<ActivityDetail, "stillNeeded" | "mine" | "myTimes" | "needsKnower"> & {
  needsKnower: number;
  myTimesJson: string | null;
};

function shape(row: Row): ActivityDetail {
  const { myTimesJson, ...rest } = row;
  let myTimes: string[] = [];
  try {
    myTimes = myTimesJson ? (JSON.parse(myTimesJson) as string[]) : [];
  } catch {
    myTimes = [];
  }
  return {
    ...rest,
    needsKnower: Boolean(row.needsKnower),
    stillNeeded: stillNeeded(row.minPeople, row.interested),
    mine: myTimesJson !== null,
    myTimes,
  };
}

export async function listCatalogue(db: D1Database, viewer: { district: string | null; personId: string | null }) {
  const { results } = await db
    .prepare(`${SELECT} WHERE a.state IN (${PUBLIC_STATES.map((s) => `'${s}'`).join(", ")})`)
    .bind(viewer.district ?? "", viewer.personId ?? "")
    .all<Row>();
  return sortCatalogue(results.map(shape));
}

export async function getActivity(db: D1Database, id: string, viewer: { district: string | null; personId: string | null }) {
  const row = await db
    .prepare(`${SELECT} WHERE a.id = ?3 AND a.state IN (${PUBLIC_STATES.map((s) => `'${s}'`).join(", ")}) LIMIT 1`)
    .bind(viewer.district ?? "", viewer.personId ?? "", id)
    .first<Row>();
  return row ? shape(row) : null;
}

/** Adds or updates the viewer's interest. Returns false if the card no longer takes interest. */
export async function setInterest(db: D1Database, activityId: string, personId: string, times: string[]): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`INSERT INTO interest (person_id, activity_id, times)
      SELECT ?1, id, ?3 FROM activity WHERE id = ?2 AND state IN ('in_catalogue', 'choosing')
      ON CONFLICT(person_id, activity_id) DO UPDATE SET times = excluded.times`)
    .bind(personId, activityId, JSON.stringify(times))
    .run();
  if (!result.meta.changes) return false;
  await db.prepare("UPDATE activity SET last_interest_at = ?2 WHERE id = ?1").bind(activityId, now).run();
  return true;
}

/** INT-02: interest can be taken back at any time. */
export async function removeInterest(db: D1Database, activityId: string, personId: string): Promise<void> {
  await db.prepare("DELETE FROM interest WHERE activity_id = ?1 AND person_id = ?2").bind(activityId, personId).run();
}
