import assert from "node:assert/strict";
import test from "node:test";
import { getActivity, setInterest } from "../db/activities.ts";
import { answerFollowup, queueFollowups, viewFollowup } from "../db/followups.ts";
import { completeGatherings, getGathering, respondHostOffer } from "../db/gatherings.ts";
import { sendDueEmails } from "../db/mailer.ts";
import type { OutgoingEmail } from "../db/ses.ts";
import { normalizeBringing, normalizeLevel } from "../lib/catalogue.ts";
import { hours, outbox, tokenFor, wonGathering } from "./helpers/fixtures.ts";

test("level and bringing are optional and tidy", () => {
  assert.equal(normalizeLevel("can_show"), "can_show");
  assert.equal(normalizeLevel("expert"), null);
  assert.equal(normalizeBringing("  a sewing   machine "), "a sewing machine");
  assert.equal(normalizeBringing(""), null);
});

test("others see how many can show and what is being brought, never who", async () => {
  const { db } = await wonGathering(); // the card still takes interest while a host is found
  await setInterest(db, "a1", "p4", [], { level: "can_show", bringing: "Litter pickers" });
  await setInterest(db, "a1", "p5", ["saturday"], { level: "never" });
  const mine = (await getActivity(db, "a1", { district: null, personId: "p4" }))!;
  assert.equal(mine.myLevel, "can_show");
  assert.equal(mine.myBringing, "Litter pickers");
  const other = (await getActivity(db, "a1", { district: null, personId: "p3" }))!;
  assert.equal(other.canShow, 1);
  assert.deepEqual(other.bringing, ["Litter pickers"]);
  assert.equal(other.myLevel, null);
  assert.doesNotMatch(JSON.stringify(other), /Person 4/);
});

async function happened() {
  const ctx = await wonGathering({ min: 2, voters: 2 });
  await respondHostOffer(ctx.db, await tokenFor(ctx.db, "p1"), true, hours(1));
  const g = (await getGathering(ctx.db, ctx.gatheringId, null))!;
  const end = new Date(g.endsAt);
  await completeGatherings(ctx.db, new Date(end.getTime() + 1000));
  return { ...ctx, end };
}

test("the follow-up goes out the next morning, once, to everyone who was going", async () => {
  const { db, end } = await happened();
  assert.equal(await queueFollowups(db, new Date(end.getTime() + 3600000)), 0); // same day
  const nextDay = new Date(end.getTime() + 24 * 3600000);
  nextDay.setUTCHours(9, 0, 0, 0);
  assert.equal(await queueFollowups(db, nextDay), 0); // before 10:00
  nextDay.setUTCHours(10, 5);
  assert.equal(await queueFollowups(db, nextDay), 1);
  assert.equal(await queueFollowups(db, nextDay), 0);
  assert.deepEqual((await outbox(db, "followup")).map((o) => o.personId), ["p1", "p2"]);

  const sent: OutgoingEmail[] = [];
  await sendDueEmails(db, { siteUrl: "https://example.org", lookupEmail: async (x) => `${x}@example.org`, send: async (m) => (sent.push(m), "x") }, nextDay);
  const mail = sent.filter((m) => m.subject.startsWith("How was"));
  assert.equal(mail.length, 2);
  assert.match(mail[0].text, /\/after\?token=[0-9a-f]{64}/);
});

test("answers are saved once; \"again\" counts the person back in", async () => {
  const { db, end } = await happened();
  const nextDay = new Date(end.getTime() + 24 * 3600000);
  nextDay.setUTCHours(11);
  await queueFollowups(db, nextDay);
  const token = JSON.parse((await outbox(db, "followup"))[0].payload).token as string;
  assert.equal((await viewFollowup(db, token))!.answered, false);
  assert.equal(await answerFollowup(db, token, { happened: true, again: true }, nextDay), "saved");
  assert.equal(await answerFollowup(db, token, { happened: false, again: false }, nextDay), "already");
  const row = await db.prepare("SELECT happened, again FROM followup WHERE person_id = 'p1'").first<{ happened: number; again: number }>();
  assert.deepEqual({ ...row }, { happened: 1, again: 1 });
  const back = await db.prepare("SELECT count(*) AS n FROM interest WHERE person_id = 'p1' AND activity_id = 'a1'").first<{ n: number }>();
  assert.equal(back!.n, 1);
  assert.equal(await answerFollowup(db, "0".repeat(64), { happened: true, again: true }), "invalid");
});
