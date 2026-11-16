// Catalogue order (CAT-01) and counters (CAT-04). Pure, so it is unit-tested.
//
// "Nearby" is still open (backlog question В5). Until it is decided, a card counts as
// nearby for a viewer when someone from the viewer's postcode district is interested.
// Cards have no address of their own: where a gathering happens is chosen later from
// the moderator's list of places.

export type CatalogueItem = {
  id: string;
  title: string;
  minPeople: number;
  maxPeople: number;
  interested: number;
  interestedNearby: number;
  createdAt: string;
  lastInterestAt: string | null;
};

export function stillNeeded(minPeople: number, interested: number): number {
  return Math.max(0, minPeople - interested);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** CAT-06: a card nobody has shown interest in for `staleAfterDays` is not removed, it sinks. */
export function isStale(item: Pick<CatalogueItem, "createdAt" | "lastInterestAt">, now: Date, staleAfterDays: number): boolean {
  const last = Date.parse(item.lastInterestAt ?? item.createdAt);
  return now.getTime() - last > staleAfterDays * DAY_MS;
}

/**
 * Nearby first; among them, the ones closest to their minimum; then newest.
 * Cards with no interest for a long time go below all the others (CAT-06).
 */
export function sortCatalogue<T extends CatalogueItem>(items: readonly T[], now = new Date(), staleAfterDays = 30): T[] {
  return [...items].sort((a, b) => {
    const staleA = isStale(a, now, staleAfterDays) ? 1 : 0;
    const staleB = isStale(b, now, staleAfterDays) ? 1 : 0;
    if (staleA !== staleB) return staleA - staleB;
    const nearA = a.interestedNearby > 0 ? 0 : 1;
    const nearB = b.interestedNearby > 0 ? 0 : 1;
    if (nearA !== nearB) return nearA - nearB;
    const needA = stillNeeded(a.minPeople, a.interested);
    const needB = stillNeeded(b.minPeople, b.interested);
    if (needA !== needB) return needA - needB;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export const TIME_CHOICES = ["weekday_evening", "saturday", "sunday"] as const;
export type TimeChoice = (typeof TIME_CHOICES)[number];

export const TIME_LABELS: Record<TimeChoice, string> = {
  weekday_evening: "Weekday evening",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** Keeps only known choices, once each, in a fixed order. Empty is allowed (INT-01). */
export function normalizeTimes(value: unknown): TimeChoice[] {
  if (!Array.isArray(value)) return [];
  return TIME_CHOICES.filter((choice) => value.includes(choice));
}

/** Interest can be added while a card is collecting people or picking an evening. */
export function acceptsInterest(state: string): boolean {
  return state === "in_catalogue" || state === "choosing";
}

// INT-04: how well the person knows the activity. Optional.
export const LEVELS = ["never", "can", "can_show"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = {
  never: "Never tried it",
  can: "I can do it",
  can_show: "I can show others",
};

export function normalizeLevel(value: unknown): Level | null {
  return LEVELS.includes(value as Level) ? (value as Level) : null;
}

/** INT-05: what the person will bring (a sewing machine, needles). Optional, short. */
export function normalizeBringing(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || null;
}
