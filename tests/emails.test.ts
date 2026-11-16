import assert from "node:assert/strict";
import test from "node:test";
import { renderEmail } from "../lib/emails.ts";

const facts = {
  siteUrl: "https://example.org",
  title: "Litter pick",
  activityId: "a1",
  gatheringId: "g1",
  startsAt: "2026-11-28T11:00:00.000Z",
  endsAt: "2026-11-28T12:30:00.000Z",
  place: { name: "Peckham Rye bandstand", address: "Peckham Rye Park" },
  bring: "Gloves",
  hostName: "Ann",
};

test("booked gathering email has when, where, what to bring, host and a link", () => {
  const email = renderEmail("gathering_scheduled", facts);
  assert.equal(email.subject, "Litter pick is on: Sat 28 Nov, 11:00–12:30");
  assert.match(email.text, /Where: Peckham Rye bandstand, Peckham Rye Park/);
  assert.match(email.text, /Bring: Gloves/);
  assert.match(email.text, /Host: Ann/);
  assert.match(email.text, /https:\/\/example\.org\/gathering\/g1/);
});

test("hosting offer links to the one-time answer page with its deadline", () => {
  const email = renderEmail("host_offer", { ...facts, token: "f".repeat(64), deadlineAt: "2026-11-19T14:00:00.000Z" });
  assert.match(email.text, /\/host\?token=f{64}/);
  assert.match(email.text, /answer by Thu 19 Nov, 14:00/);
  assert.match(email.text, /still going either way/);
});

test("text from people is escaped in the HTML version", () => {
  const email = renderEmail("round_failed", { ...facts, title: "<b>Knit</b> & natter" });
  assert.doesNotMatch(email.html, /<b>Knit/);
  assert.match(email.html, /&lt;b&gt;Knit&lt;\/b&gt; &amp; natter/);
});

test("every template renders with a subject and a link", () => {
  for (const t of ["round_opened", "round_failed", "host_offer", "gathering_scheduled", "below_minimum", "gathering_cancelled", "reminder"] as const) {
    const email = renderEmail(t, { ...facts, token: "x", closesAt: "2026-11-25T11:00:00.000Z", going: 2, minPeople: 3, reason: "no_host" });
    assert.ok(email.subject.length > 5, t);
    assert.match(email.text, /https:\/\/example\.org\//, t);
    assert.doesNotMatch(email.text, /undefined/, t);
  }
});
