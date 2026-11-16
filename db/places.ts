// The moderator's list of places (backlog 5.1, PLC-01/PLC-02/PLC-05) and the
// moderator's view of live gatherings (8.4).
import type { PlaceInput } from "../lib/place-input.ts";

export type PlaceRow = Omit<PlaceInput, "stepFree" | "active" | "windows"> & {
  id: string;
  stepFree: boolean;
  active: boolean;
  windows: PlaceInput["windows"];
};

export async function listPlaces(db: D1Database): Promise<PlaceRow[]> {
  const { results: places } = await db
    .prepare(`SELECT id, name, address, postcode_district AS postcodeDistrict, kind, capacity, facilities,
        step_free AS stepFree, price_text AS priceText, terms_text AS termsText, booking_email AS bookingEmail, active
      FROM place ORDER BY active DESC, name`)
    .all<Omit<PlaceRow, "windows" | "stepFree" | "active"> & { stepFree: number; active: number }>();
  const { results: windows } = await db
    .prepare(`SELECT place_id AS placeId, weekday, start_time AS startTime, end_time AS endTime, auto_approve AS autoApprove
      FROM place_window ORDER BY weekday, start_time`)
    .all<{ placeId: string; weekday: number; startTime: string; endTime: string; autoApprove: number }>();
  return places.map((p) => ({
    ...p,
    stepFree: Boolean(p.stepFree),
    active: Boolean(p.active),
    windows: windows
      .filter((w) => w.placeId === p.id)
      .map(({ weekday, startTime, endTime, autoApprove }) => ({ weekday, startTime, endTime, autoApprove: Boolean(autoApprove) })),
  }));
}

/** Adds a place, or replaces one's details and standing windows. Logged in mod_action. */
export async function savePlace(db: D1Database, actorId: string, place: PlaceInput, id: string | null = null): Promise<string | null> {
  const placeId = id ?? crypto.randomUUID();
  if (id) {
    const exists = await db.prepare("SELECT 1 AS ok FROM place WHERE id = ?1").bind(id).first();
    if (!exists) return null;
  }
  const values = [
    placeId, place.name, place.address, place.postcodeDistrict, place.kind, place.capacity, place.facilities,
    place.stepFree ? 1 : 0, place.priceText, place.termsText, place.bookingEmail, place.active ? 1 : 0,
  ];
  await db.batch([
    db
      .prepare(`INSERT INTO place (id, name, address, postcode_district, kind, capacity, facilities, step_free,
          price_text, terms_text, booking_email, active)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address,
          postcode_district = excluded.postcode_district, kind = excluded.kind, capacity = excluded.capacity,
          facilities = excluded.facilities, step_free = excluded.step_free, price_text = excluded.price_text,
          terms_text = excluded.terms_text, booking_email = excluded.booking_email, active = excluded.active`)
      .bind(...values),
    db.prepare("DELETE FROM place_window WHERE place_id = ?1").bind(placeId),
    ...place.windows.map((w) =>
      db
        .prepare(`INSERT INTO place_window (id, place_id, weekday, start_time, end_time, auto_approve)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(crypto.randomUUID(), placeId, w.weekday, w.startTime, w.endTime, w.autoApprove ? 1 : 0),
    ),
    db
      .prepare(`INSERT INTO mod_action (id, actor_id, action, target_kind, target_id) VALUES (?1, ?2, ?3, 'place', ?4)`)
      .bind(crypto.randomUUID(), actorId, id ? "edit_place" : "add_place", placeId),
  ]);
  return placeId;
}

export type ModGathering = {
  id: string;
  title: string;
  status: "awaiting_place" | "scheduled";
  startsAt: string;
  endsAt: string;
  placeName: string | null;
  going: number;
  minPeople: number;
  hasHost: boolean;
};

/** 8.4: every live gathering, soonest first. Counts only, like everywhere else. */
export async function listLiveGatherings(db: D1Database): Promise<ModGathering[]> {
  const { results } = await db
    .prepare(`SELECT g.id, a.title, g.status, s.starts_at AS startsAt, s.ends_at AS endsAt, pl.name AS placeName,
        (SELECT count(*) FROM attendance at WHERE at.gathering_id = g.id AND at.status = 'going') AS going,
        a.min_people AS minPeople, g.host_person_id IS NOT NULL AS hasHost
      FROM gathering g JOIN slot s ON s.id = g.slot_id JOIN round r ON r.id = g.round_id
      JOIN activity a ON a.id = r.activity_id LEFT JOIN place pl ON pl.id = g.place_id
      WHERE g.status IN ('awaiting_place', 'scheduled') ORDER BY s.starts_at`)
    .all<Omit<ModGathering, "hasHost"> & { hasHost: number }>();
  return results.map((g) => ({ ...g, hasHost: Boolean(g.hasHost) }));
}
