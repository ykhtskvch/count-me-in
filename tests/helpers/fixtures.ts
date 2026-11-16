// Shared test fixtures: a card whose first slot has just won.
import assert from "node:assert/strict";
import { setInterest } from "../../db/activities.ts";
import { getOpenRound, openRoundIfReady, voteSlot } from "../../db/rounds.ts";
import { testDatabase } from "./d1.ts";

export const now = new Date("2026-11-16T10:00:00Z");
export const hours = (h: number) => new Date(now.getTime() + h * 3600000);

export type Venue = { id: string; name: string; capacity?: number; window?: { weekday: number; start: string; end: string; auto: boolean } };

export async function wonGathering(
  opts: { min?: number; max?: number; people?: number; voters?: number; place?: boolean; venues?: Venue[] } = {},
) {
  const db = testDatabase();
  const people = opts.people ?? 6;
  for (let n = 1; n <= people; n++) {
    await db
      .prepare(`INSERT INTO person (id, auth_user_id, display_name, postcode_district, adult_confirmed_at, rules_version)
        VALUES (?1, ?1, ?2, 'SE15', '2026-11-16', 'r1')`)
      .bind(`p${n}`, `Person ${n}`)
      .run();
  }
  if (opts.place !== false) {
    await db
      .prepare(`INSERT INTO place (id, name, address, postcode_district, kind, step_free)
        VALUES ('pl1', 'Peckham Rye bandstand', 'Peckham Rye Park', 'SE15', 'public', 1)`)
      .run();
  }
  for (const v of opts.venues ?? []) {
    await db
      .prepare(`INSERT INTO place (id, name, address, postcode_district, kind, step_free, capacity, booking_email)
        VALUES (?1, ?2, '1 High St', 'SE15', 'venue', 1, ?3, ?4)`)
      .bind(v.id, v.name, v.capacity ?? null, `${v.id}@venue.example`)
      .run();
    if (v.window) {
      await db
        .prepare(`INSERT INTO place_window (id, place_id, weekday, start_time, end_time, auto_approve)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(`w-${v.id}`, v.id, v.window.weekday, v.window.start, v.window.end, v.window.auto ? 1 : 0)
        .run();
    }
  }
  await db
    .prepare(`INSERT INTO activity (id, title, outcome, min_people, max_people, duration_min, place_kind, bring, state)
      VALUES ('a1', 'Litter pick', 'A cleaner park', ?1, ?2, 90, ?3, 'Gloves', 'in_catalogue')`)
    .bind(opts.min ?? 3, opts.max ?? 6, opts.venues ? "venue" : "public")
    .run();
  const voters = opts.voters ?? opts.min ?? 3;
  for (let n = 1; n <= voters; n++) await setInterest(db, "a1", `p${n}`, []);
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  let gatheringId: string | null = null;
  for (let n = 1; n <= voters; n++) {
    const r = await voteSlot(db, slot.id, `p${n}`, true, new Date(now.getTime() + n * 1000));
    if (r.ok && r.gatheringId) gatheringId = r.gatheringId;
  }
  assert.ok(gatheringId);
  return { db, gatheringId };
}

export const cardState = async (db: D1Database) =>
  (await db.prepare("SELECT state FROM activity WHERE id = 'a1'").first<{ state: string }>())!.state;

export async function outbox(db: D1Database, template: string) {
  const { results } = await db
    .prepare("SELECT person_id AS personId, payload FROM email_outbox WHERE template = ?1 ORDER BY person_id")
    .bind(template)
    .all<{ personId: string; payload: string }>();
  return results;
}

export const tokenFor = async (db: D1Database, personId: string) => {
  const rows = (await outbox(db, "host_offer")).filter((r) => r.personId === personId);
  return JSON.parse(rows.at(-1)!.payload).token as string;
};

