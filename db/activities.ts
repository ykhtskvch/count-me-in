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
  myLevel: string | null;
  myBringing: string | null;
  /** How many interested people can show others (INT-04). A count, never names. */
  canShow: number;
  /** What people said they would bring (INT-05), without saying who. */
  bringing: string[];
};

const SELECT = `SELECT a.id, a.title, a.outcome, a.min_people AS minPeople, a.max_people AS maxPeople,
    a.duration_min AS durationMin, a.place_kind AS placeKind, a.state, a.times_run AS timesRun,
    a.bring, a.materials_cost_pence AS materialsCostPence, a.needs_knower AS needsKnower, a.season,
    a.created_at AS createdAt, a.last_interest_at AS lastInterestAt,
    (SELECT count(*) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL) AS interested,
    (SELECT count(*) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL AND p.postcode_district = ?1) AS interestedNearby,
    (SELECT i.times FROM interest i WHERE i.activity_id = a.id AND i.person_id = ?2) AS myTimesJson,
    (SELECT i.level FROM interest i WHERE i.activity_id = a.id AND i.person_id = ?2) AS myLevel,
    (SELECT i.bringing FROM interest i WHERE i.activity_id = a.id AND i.person_id = ?2) AS myBringing,
    (SELECT count(*) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL AND i.level = 'can_show') AS canShow,
    (SELECT json_group_array(i.bringing) FROM interest i JOIN person p ON p.id = i.person_id
       WHERE i.activity_id = a.id AND p.blocked_at IS NULL AND i.bringing IS NOT NULL) AS bringingJson
  FROM activity a`;

type Row = Omit<ActivityDetail, "stillNeeded" | "mine" | "myTimes" | "needsKnower" | "bringing"> & {
  needsKnower: number;
  myTimesJson: string | null;
  bringingJson: string | null;
};

function parseList(json: string | null): string[] {
  try {
    const parsed = json ? JSON.parse(json) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function shape(row: Row): ActivityDetail {
  const { myTimesJson, bringingJson, ...rest } = row;
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
    bringing: parseList(bringingJson),
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
export async function setInterest(
  db: D1Database,
  activityId: string,
  personId: string,
  times: string[],
  details: { level?: string | null; bringing?: string | null } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`INSERT INTO interest (person_id, activity_id, times, level, bringing)
      SELECT ?1, id, ?3, ?4, ?5 FROM activity WHERE id = ?2 AND state IN ('in_catalogue', 'choosing')
      ON CONFLICT(person_id, activity_id) DO UPDATE SET times = excluded.times, level = excluded.level, bringing = excluded.bringing`)
    .bind(personId, activityId, JSON.stringify(times), details.level ?? null, details.bringing ?? null)
    .run();
  if (!result.meta.changes) return false;
  await db.prepare("UPDATE activity SET last_interest_at = ?2 WHERE id = ?1").bind(activityId, now).run();
  return true;
}

/** INT-02: interest can be taken back at any time. */
export async function removeInterest(db: D1Database, activityId: string, personId: string): Promise<void> {
  await db.prepare("DELETE FROM interest WHERE activity_id = ?1 AND person_id = ?2").bind(activityId, personId).run();
}
