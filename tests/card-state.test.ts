import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_EVENTS,
  CARD_STATES,
  InvalidTransitionError,
  canTransition,
  nextState,
  reachableFrom,
} from "../lib/card-state.ts";

test("a suggested card is published or rejected", () => {
  assert.equal(nextState("in_review", "published"), "in_catalogue");
  assert.equal(nextState("in_review", "rejected"), "removed");
});

test("the venue path: catalogue, choosing, awaiting place, scheduled, back to catalogue", () => {
  let state = nextState("in_catalogue", "threshold_reached");
  assert.equal(state, "choosing");
  state = nextState(state, "slot_won_needs_venue");
  assert.equal(state, "awaiting_place");
  state = nextState(state, "venue_and_host_confirmed");
  assert.equal(state, "scheduled");
  assert.equal(nextState(state, "gathering_happened"), "in_catalogue");
});

test("the no-venue path goes from choosing straight to scheduled once a host accepts", () => {
  assert.equal(nextState("choosing", "host_confirmed_no_venue"), "scheduled");
});

test("every failure returns the card to the catalogue", () => {
  assert.equal(nextState("choosing", "round_failed"), "in_catalogue");
  assert.equal(nextState("awaiting_place", "no_places_left"), "in_catalogue");
  assert.equal(nextState("awaiting_place", "round_failed"), "in_catalogue");
  assert.equal(nextState("scheduled", "gathering_cancelled"), "in_catalogue");
});

test("a card in review cannot be scheduled directly", () => {
  assert.equal(canTransition("in_review", "venue_and_host_confirmed"), false);
  assert.throws(() => nextState("in_review", "venue_and_host_confirmed"), InvalidTransitionError);
});

test("a removed card goes nowhere", () => {
  for (const event of CARD_EVENTS) assert.equal(canTransition("removed", event), false);
});

test("any live card can be removed", () => {
  for (const state of CARD_STATES) {
    if (state !== "removed") assert.equal(nextState(state, "removed"), "removed");
  }
});

test("every state except removed is reachable and has a way out", () => {
  const reached = new Set(CARD_STATES.flatMap((s) => reachableFrom(s)));
  for (const state of CARD_STATES) {
    if (state !== "in_review") assert.ok(reached.has(state), `${state} is unreachable`);
    if (state !== "removed") assert.ok(reachableFrom(state).length > 0, `${state} is a dead end`);
  }
});

test("a host stepping down puts a booked gathering back to waiting until someone else accepts", () => {
  assert.equal(nextState("scheduled", "host_left"), "awaiting_place");
  assert.equal(nextState("awaiting_place", "host_confirmed_no_venue"), "scheduled");
  assert.equal(nextState("choosing", "gathering_cancelled"), "in_catalogue");
});
