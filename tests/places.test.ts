import assert from "node:assert/strict";
import test from "node:test";
import { listLiveGatherings, listPlaces, savePlace } from "../db/places.ts";
import { normalizePlace } from "../lib/place-input.ts";
import { wonGathering } from "./helpers/fixtures.ts";

const park = { name: "Peckham Rye bandstand", address: "Peckham Rye Park, by the café", postcode: "SE15 3UA", kind: "public", stepFree: true };

test("a public place needs a name, address, postcode and type; a full postcode is cut to its district", () => {
  const result = normalizePlace(park);
  assert.ok(result.ok);
  assert.equal(result.place.postcodeDistrict, "SE15");
  const bad = normalizePlace({ kind: "house" });
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.fields).sort(), ["address", "kind", "name", "postcode"]);
});

test("an indoor venue needs a booking email; windows must make sense", () => {
  const venue = normalizePlace({ ...park, kind: "venue" });
  assert.ok(!venue.ok && venue.fields.bookingEmail);
  const windows = normalizePlace({ ...park, windows: [{ weekday: 3, startTime: "21:00", endTime: "19:00" }] });
  assert.ok(!windows.ok && windows.fields.windows);
  const good = normalizePlace({ ...park, kind: "venue", bookingEmail: "Hall@Example.org", capacity: "20", windows: [{ weekday: 3, startTime: "19:00", endTime: "21:00" }] });
  assert.ok(good.ok);
  assert.equal(good.place.bookingEmail, "hall@example.org");
  assert.equal(good.place.capacity, 20);
});

test("saving a place stores its windows, editing replaces them, and both are logged", async () => {
  const { db } = await wonGathering({ place: false });
  const first = normalizePlace({ ...park, windows: [{ weekday: 6, startTime: "10:00", endTime: "13:00" }] });
  assert.ok(first.ok);
  const id = await savePlace(db, "p6", first.place);
  let [saved] = await listPlaces(db);
  assert.equal(saved.windows.length, 1);
  assert.equal(saved.stepFree, true);

  const edit = normalizePlace({ ...park, name: "Bandstand", active: false, windows: [] });
  assert.ok(edit.ok);
  assert.equal(await savePlace(db, "p6", edit.place, id), id);
  [saved] = await listPlaces(db);
  assert.equal(saved.name, "Bandstand");
  assert.equal(saved.active, false);
  assert.equal(saved.windows.length, 0);
  assert.equal(await savePlace(db, "p6", edit.place, "missing"), null);
  const log = await db.prepare("SELECT action FROM mod_action ORDER BY at").all<{ action: string }>();
  assert.deepEqual(log.results.map((r) => r.action), ["add_place", "edit_place"]);
});

test("the moderator sees live gatherings with counts", async () => {
  const { db, gatheringId } = await wonGathering();
  const [g] = await listLiveGatherings(db);
  assert.equal(g.id, gatheringId);
  assert.equal(g.going, 3);
  assert.equal(g.hasHost, false);
});
