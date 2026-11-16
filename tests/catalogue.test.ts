import assert from "node:assert/strict";
import test from "node:test";
import { acceptsInterest, normalizeTimes, sortCatalogue, stillNeeded } from "../lib/catalogue.ts";

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
    card("far-old", 0, 0, "2026-10-01"),
  ]);
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
