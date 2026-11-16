// Checks a suggested activity card (backlog 1.x/8.1, PRD CAT-02, CAT-03, CAT-08).
// Cards have no date and no address: when and where are chosen later by the platform.

export type CardInput = {
  title: string;
  outcome: string;
  minPeople: number;
  maxPeople: number;
  durationMin: number;
  bring: string;
  materialsCostPence: number;
  placeKind: "venue" | "public";
  needsKnower: boolean;
  season: string | null;
  instructions: string | null;
};

type Result = { ok: true; card: CardInput } | { ok: false; fields: Record<string, string> };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const int = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN);

/** MOD-02: reasons a moderator can give when rejecting, shown to the author. */
export const REJECTION_REASONS = {
  home: "It would need to meet at someone’s home. Gatherings only happen at public places from our list.",
  risk: "It carries a health or safety risk we can’t check.",
  advert: "It advertises a paid service.",
  minors: "It is meant for children or teenagers. Count Me In is for adults only.",
  unclear: "It isn’t clear enough what people would do or make. Please try again with more detail.",
} as const;

export type RejectionReason = keyof typeof REJECTION_REASONS;

export function normalizeCard(raw: unknown): Result {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const title = text(input.title, 80);
  if (title.length < 3) fields.title = "Give the activity a short name.";
  const outcome = text(input.outcome, 200);
  if (outcome.length < 3) fields.outcome = "Say what people will have done or made by the end.";

  const minPeople = int(input.minPeople);
  const maxPeople = int(input.maxPeople);
  if (!Number.isInteger(minPeople) || minPeople < 2 || minPeople > 30) fields.minPeople = "The minimum is a whole number from 2 to 30.";
  if (!Number.isInteger(maxPeople) || maxPeople > 50 || maxPeople < (Number.isInteger(minPeople) ? minPeople : 2)) {
    fields.maxPeople = "The maximum is at least the minimum and at most 50.";
  }

  const hours = int(input.durationHours);
  const durationMin = Math.round(hours * 60);
  if (!Number.isFinite(hours) || durationMin < 30 || durationMin > 8 * 60) fields.durationHours = "How long, from half an hour to 8 hours.";

  const pounds = input.materialsCost === undefined || input.materialsCost === "" ? 0 : int(input.materialsCost);
  const materialsCostPence = Math.round(pounds * 100);
  if (!Number.isFinite(pounds) || materialsCostPence < 0 || materialsCostPence > 5000) fields.materialsCost = "Materials per person, from £0 to £50.";

  const placeKind = input.placeKind === "venue" || input.placeKind === "public" ? input.placeKind : null;
  if (!placeKind) fields.placeKind = "Choose indoor venue or public place.";

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    card: {
      title,
      outcome,
      minPeople,
      maxPeople,
      durationMin,
      bring: text(input.bring, 200),
      materialsCostPence,
      placeKind: placeKind!,
      needsKnower: input.needsKnower === true,
      season: text(input.season, 40) || null,
      instructions: typeof input.instructions === "string" ? input.instructions.trim().slice(0, 2000) || null : null,
    },
  };
}
