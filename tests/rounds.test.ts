import assert from "node:assert/strict";
import test from "node:test";
import { setInterest } from "../db/activities.ts";
import { closeDueRounds, getOpenRound, openRoundIfReady, removeOpenVotes, voteSlot } from "../db/rounds.ts";
import { testDatabase } from "./helpers/d1.ts";

const now = new Date("2026-11-16T10:00:00Z");

async function setup(opts: { min?: number; max?: number; placeKind?: "venue" | "public"; people?: number } = {}) {
  const db = testDatabase();
  const people = opts.people ?? 5;
  for (let n = 1; n <= people; n++) {
    await db
      .prepare(`INSERT INTO person (id, auth_user_id, display_name, postcode_district, adult_confirmed_at, rules_version)
        VALUES (?1, ?1, ?2, 'SE15', '2026-11-16', 'r1')`)
      .bind(`p${n}`, `Person ${n}`)
      .run();
  }
  await db
    .prepare(`INSERT INTO activity (id, title, outcome, min_people, max_people, duration_min, place_kind, state)
      VALUES ('a1', 'Mend a jumper', 'Each leaves with a mended jumper', ?1, ?2, 120, ?3, 'in_catalogue')`)
    .bind(opts.min ?? 3, opts.max ?? 6, opts.placeKind ?? "public")
    .run();
  return db;
}

const state = async (db: D1Database) =>
  (await db.prepare("SELECT state FROM activity WHERE id = 'a1'").first<{ state: string }>())!.state;

async function interestFrom(db: D1Database, ...ids: string[]) {
  for (const id of ids) await setInterest(db, "a1", id, []);
}

test("no round below the minimum; reaching it opens one with three slots", async () => {
  const db = await setup();
  await interestFrom(db, "p1", "p2");
  assert.equal(await openRoundIfReady(db, "a1", now), null);
  assert.equal(await state(db), "in_catalogue");

  await interestFrom(db, "p3");
  const roundId = await openRoundIfReady(db, "a1", now);
  assert.ok(roundId);
  assert.equal(await state(db), "choosing");
  const round = await getOpenRound(db, "a1", "p1");
  assert.equal(round?.slots.length, 3);
  assert.ok(round!.slots.every((s) => s.canMake === 0 && !s.mine));

  // Opening again is a no-op: one open round per card.
  assert.equal(await openRoundIfReady(db, "a1", now), null);
});

test("first slot to reach the minimum becomes the gathering; the others close", async () => {
  const db = await setup({ placeKind: "venue" });
  await interestFrom(db, "p1", "p2", "p3");
  await openRoundIfReady(db, "a1", now);
  const [first, second] = (await getOpenRound(db, "a1", null))!.slots;

  for (const p of ["p1", "p2"]) assert.deepEqual(await voteSlot(db, first.id, p, true, now), { ok: true, gatheringId: null });
  assert.deepEqual(await voteSlot(db, second.id, "p1", true, now), { ok: true, gatheringId: null });
  assert.equal((await getOpenRound(db, "a1", "p1"))!.slots.find((s) => s.id === first.id)!.canMake, 2);

  const win = await voteSlot(db, first.id, "p3", true, now);
  assert.ok(win.ok && win.gatheringId);
  assert.equal(await state(db), "awaiting_place");
  assert.equal(await getOpenRound(db, "a1", null), null);

  const slots = await db.prepare("SELECT id, status FROM slot ORDER BY starts_at").all<{ id: string; status: string }>();
  assert.deepEqual(slots.results.map((s) => s.status).sort(), ["closed", "closed", "won"]);
  const going = await db.prepare("SELECT count(*) AS n FROM attendance").first<{ n: number }>();
  assert.equal(going!.n, 3);

  // The round is over: more votes are refused.
  assert.deepEqual(await voteSlot(db, second.id, "p4", true, now), { ok: false, reason: "closed" });
});

test("a public card stays in choosing until a host accepts", async () => {
  const db = await setup({ min: 2, placeKind: "public" });
  await interestFrom(db, "p1", "p2");
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  await voteSlot(db, slot.id, "p1", true, now);
  const win = await voteSlot(db, slot.id, "p2", true, now);
  assert.ok(win.ok && win.gatheringId);
  assert.equal(await state(db), "choosing");
});

test("up to the maximum are going; the rest wait for next time", async () => {
  const db = await setup({ min: 2, max: 2, people: 4 });
  await interestFrom(db, "p1", "p2", "p3", "p4");
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  await voteSlot(db, slot.id, "p1", true, now);
  await voteSlot(db, slot.id, "p2", true, now);
  const queued = await db.prepare("SELECT person_id AS id FROM interest WHERE queued = 1 ORDER BY person_id").all<{ id: string }>();
  assert.deepEqual(queued.results.map((r) => r.id), ["p3", "p4"]);
});

test("ticking a slot counts you in; taking interest back takes the tick back", async () => {
  const db = await setup({ min: 3 });
  await interestFrom(db, "p1", "p2", "p3");
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  await voteSlot(db, slot.id, "p4", true, now);
  const p4 = await db.prepare("SELECT 1 AS ok FROM interest WHERE person_id = 'p4'").first();
  assert.ok(p4);
  await removeOpenVotes(db, "a1", "p4");
  assert.equal((await getOpenRound(db, "a1", null))!.slots[0].canMake, 0);
  await voteSlot(db, slot.id, "p1", true, now);
  await voteSlot(db, slot.id, "p1", false, now);
  assert.equal((await getOpenRound(db, "a1", null))!.slots[0].canMake, 0);
});

test("blocked people are not counted towards a slot", async () => {
  const db = await setup({ min: 2 });
  await interestFrom(db, "p1", "p2");
  await openRoundIfReady(db, "a1", now);
  const [slot] = (await getOpenRound(db, "a1", null))!.slots;
  await db.prepare("UPDATE person SET blocked_at = '2026-11-16' WHERE id = 'p2'").run();
  await voteSlot(db, slot.id, "p1", true, now);
  const result = await voteSlot(db, slot.id, "p2", true, now);
  assert.deepEqual(result, { ok: true, gatheringId: null });
});

test("picking closes 3 days before the first slot; the card goes back with its interest", async () => {
  const db = await setup();
  await interestFrom(db, "p1", "p2", "p3");
  await openRoundIfReady(db, "a1", now);
  const round = (await getOpenRound(db, "a1", null))!;
  assert.deepEqual(await closeDueRounds(db, new Date(Date.parse(round.closesAt) - 1000)), []);

  const later = new Date(Date.parse(round.closesAt) + 1000);
  assert.deepEqual(await voteSlot(db, round.slots[0].id, "p1", true, later), { ok: false, reason: "closed" });
  assert.equal((await closeDueRounds(db, later)).length, 1);
  assert.equal(await state(db), "in_catalogue");
  const kept = await db.prepare("SELECT count(*) AS n FROM interest").first<{ n: number }>();
  assert.equal(kept!.n, 3);
});
