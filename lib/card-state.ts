// Card (Activity) lifecycle, backlog item 0.3.
// States follow the PRD. "Happened" and "Didn't come together" are outcomes of a
// round or gathering, not card states: the card goes straight back to the catalogue.
// A rejected card goes to "removed" with a reason, since the PRD has no separate state.

export const CARD_STATES = [
  "in_review",
  "in_catalogue",
  "choosing",
  "awaiting_place",
  "scheduled",
  "removed",
] as const;

export type CardState = (typeof CARD_STATES)[number];

export const CARD_EVENTS = [
  "published", // moderator approved a suggested card
  "rejected", // moderator rejected a suggested card, with a reason
  "threshold_reached", // interest reached min_people
  "slot_won_needs_venue", // first slot to reach min_people, card needs a venue
  "venue_and_host_confirmed", // venue approved and a host accepted
  "host_confirmed_no_venue", // no venue needed and a host accepted
  "round_failed", // picking closed without a winning slot, or no host before it closed
  "no_places_left", // every suitable venue declined or stayed silent
  "gathering_happened", // the gathering's end time passed
  "gathering_cancelled", // moderator cancelled the gathering, or no host could be found
  "host_left", // the host of a booked gathering stepped down; the next person going is asked
  "removed", // moderator hid the card or the author withdrew it
] as const;

export type CardEvent = (typeof CARD_EVENTS)[number];

const TRANSITIONS: Record<CardState, Partial<Record<CardEvent, CardState>>> = {
  in_review: { published: "in_catalogue", rejected: "removed", removed: "removed" },
  in_catalogue: { threshold_reached: "choosing", removed: "removed" },
  choosing: {
    slot_won_needs_venue: "awaiting_place",
    host_confirmed_no_venue: "scheduled",
    round_failed: "in_catalogue",
    gathering_cancelled: "in_catalogue", // a public card's gathering found no host
    removed: "removed",
  },
  awaiting_place: {
    venue_and_host_confirmed: "scheduled",
    host_confirmed_no_venue: "scheduled", // a public card whose host stepped down got a new one
    no_places_left: "in_catalogue",
    round_failed: "in_catalogue",
    gathering_cancelled: "in_catalogue",
    removed: "removed",
  },
  scheduled: {
    gathering_happened: "in_catalogue",
    gathering_cancelled: "in_catalogue",
    host_left: "awaiting_place",
    removed: "removed",
  },
  removed: {},
};

export class InvalidTransitionError extends Error {
  readonly from: CardState;
  readonly event: CardEvent;

  constructor(from: CardState, event: CardEvent) {
    super(`Card cannot go from "${from}" on "${event}".`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.event = event;
  }
}

export function canTransition(from: CardState, event: CardEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function nextState(from: CardState, event: CardEvent): CardState {
  const to = TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

/** Every state a card can reach from `from` in one step. */
export function reachableFrom(from: CardState): CardState[] {
  return [...new Set(Object.values(TRANSITIONS[from]))] as CardState[];
}
