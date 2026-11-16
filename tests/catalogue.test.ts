import assert from "node:assert/strict";
import test from "node:test";
import { acceptsInterest, isStale, normalizeTimes, sortCatalogue, stillNeeded } from "../lib/catalogue.ts";

const now = new Date("2026-11-16T10:00:00Z");

const card = (id: string, interested: number, interestedNearby: number, createdAt = "2026-11-01") => ({
  id, title: id, minPeople: 4, maxPeople: 10, interested, interestedNearby, createdAt, lastInterestAt: null,
});

test("still needed never goes below zero", () => {
  assert.equal(stillNeeded(4, 1), 3);
  assert.equal(stillNeeded(4, 6), 0);
});

test("nearby cards come first, then the ones closest to their minimum, then newest", () => {
  const sorted = sortCatalogue([
    card("far-almost-full", 3, 0),
    card("near-empty", 1, 1),
    card("near-almost-full", 3, 2),
    card("far-new", 0, 0, "2026-11-10"),
    card("far-old", 0, 0, "2026-10-20"),
  ], now);
  assert.deepEqual(sorted.map((c) => c.id), ["near-almost-full", "near-empty", "far-almost-full", "far-new", "far-old"]);
});

test("times keep only known choices, in a fixed order", () => {
  assert.deepEqual(normalizeTimes(["sunday", "weekday_evening", "sunday", "midnight"]), ["weekday_evening", "sunday"]);
  assert.deepEqual(normalizeTimes("sunday"), []);
  assert.deepEqual(normalizeTimes(undefined), []);
});

test("interest is open while collecting people or picking an evening", () => {
  assert.equal(acceptsInterest("in_catalogue"), true);
  assert.equal(acceptsInterest("choosing"), true);
  assert.equal(acceptsInterest("in_review"), false);
  assert.equal(acceptsInterest("scheduled"), false);
  assert.equal(acceptsInterest("removed"), false);
});

test("a card with no interest for 30 days sinks below fresh ones, even nearby ones, and is not removed", () => {
  const old = { ...card("old-near", 3, 2, "2026-09-01"), lastInterestAt: "2026-10-01T00:00:00Z" };
  const revived = { ...card("old-but-active", 1, 0, "2026-09-01"), lastInterestAt: "2026-11-10T00:00:00Z" };
  const fresh = card("fresh-far", 0, 0, "2026-11-12");
  assert.equal(isStale(old, now, 30), true);
  assert.equal(isStale(revived, now, 30), false);
  assert.deepEqual(sortCatalogue([old, fresh, revived], now, 30).map((c) => c.id), ["old-but-active", "fresh-far", "old-near"]);
});
