import assert from "node:assert/strict";
import test from "node:test";
import { londonParts, londonToUtc, proposeSlots, roundClosesAt } from "../lib/slots.ts";

// Monday 16 November 2026, 10:00 UTC (GMT, so London = UTC).
const now = new Date("2026-11-16T10:00:00Z");

test("London wall clock converts across GMT and BST", () => {
  assert.equal(londonToUtc("2026-12-05", "11:00").toISOString(), "2026-12-05T11:00:00.000Z");
  assert.equal(londonToUtc("2026-07-04", "11:00").toISOString(), "2026-07-04T10:00:00.000Z");
  assert.equal(londonParts(new Date("2026-11-21T12:00:00Z")).weekday, 6);
});

test("offers three slots 7–14 days out, one per kind of time, picking closes 3 days before the first", () => {
  const slots = proposeSlots({ now, durationMin: 120, interestTimes: [[], [], []] });
  assert.equal(slots.length, 3);
  assert.deepEqual(new Set(slots.map((s) => s.kind)), new Set(["weekday_evening", "saturday", "sunday"]));
  for (const s of slots) {
    const days = (Date.parse(s.startsAt) - now.getTime()) / 86400000;
    assert.ok(days >= 6.5 && days <= 14.5, `${s.startsAt} is outside the window`);
    assert.equal(Date.parse(s.endsAt) - Date.parse(s.startsAt), 120 * 60000);
  }
  const closes = Date.parse(roundClosesAt(slots));
  assert.equal(Date.parse(slots[0].startsAt) - closes, 3 * 86400000);
  assert.ok(closes > now.getTime());
});

test("follows what people ticked: Saturday people get Saturdays", () => {
  const slots = proposeSlots({ now, durationMin: 90, interestTimes: [["saturday"], ["saturday"], ["saturday", "sunday"]] });
  // The window holds one Saturday and one Sunday; nobody asked for a weekday evening.
  assert.deepEqual(slots.map((s) => s.kind), ["saturday", "sunday"]);
  // Weekend start is 11:00 London.
  assert.match(slots[0].startsAt, /T11:00:00/);
});

test("weekday evenings start at 18:30", () => {
  const slots = proposeSlots({ now, durationMin: 60, interestTimes: [["weekday_evening"], ["weekday_evening"]] });
  assert.ok(slots.every((s) => s.kind === "weekday_evening" && s.startsAt.endsWith("T18:30:00.000Z")));
});

test("indoor cards use venue windows and skip ones too short", () => {
  const slots = proposeSlots({
    now,
    durationMin: 120,
    interestTimes: [[], []],
    windows: [
      { weekday: 3, startTime: "19:00", endTime: "21:30" },
      { weekday: 4, startTime: "18:00", endTime: "21:00" },
      { weekday: 5, startTime: "19:00", endTime: "20:00" },
    ],
  });
  // Wednesday and Thursday fit two hours; Friday's one-hour window does not.
  assert.deepEqual(slots.map((s) => londonParts(new Date(s.startsAt)).weekday), [3, 4]);
  assert.deepEqual(slots.map((s) => s.startsAt.slice(11, 16)), ["19:00", "18:00"]);
});

test("slot labels are in London time", async () => {
  const { slotLabel, slotCounter } = await import("../lib/slots.ts");
  assert.equal(slotLabel("2026-11-28T11:00:00.000Z", "2026-11-28T13:00:00.000Z"), "Sat 28 Nov, 11:00–13:00");
  assert.equal(slotLabel("2026-07-04T10:00:00.000Z", "2026-07-04T12:00:00.000Z"), "Sat 4 Jul, 11:00–13:00");
  assert.equal(slotCounter(1, 3), "1 can make it · 2 more needed");
  assert.equal(slotCounter(3, 3), "3 can make it");
});
