// Checks a place the moderator adds or edits (backlog 5.1, PRD PLC-01, PLC-02, PLC-05).
// Only the moderator adds places, which is what keeps gatherings out of homes:
// participants can never type an address.
import { normalizePostcodeDistrict } from "./auth-input.ts";

export type PlaceInput = {
  name: string;
  address: string;
  postcodeDistrict: string;
  kind: "venue" | "public";
  capacity: number | null;
  facilities: string;
  stepFree: boolean;
  priceText: string | null;
  termsText: string | null;
  bookingEmail: string | null;
  active: boolean;
  windows: { weekday: number; startTime: string; endTime: string; autoApprove: boolean }[];
};

type Result = { ok: true; place: PlaceInput } | { ok: false; fields: Record<string, string> };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizePlace(raw: unknown): Result {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const name = text(input.name, 80);
  if (!name) fields.name = "Give the place a name.";
  const address = text(input.address, 200);
  if (!address) fields.address = "Add the address people should go to.";
  const district = normalizePostcodeDistrict(typeof input.postcode === "string" ? input.postcode : "");
  if (!district) fields.postcode = "Enter a postcode or its first half, like SE15.";
  const kind = input.kind === "venue" || input.kind === "public" ? input.kind : null;
  if (!kind) fields.kind = "Choose indoor venue or public place.";

  let capacity: number | null = null;
  if (input.capacity !== undefined && input.capacity !== null && input.capacity !== "") {
    capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 500) fields.capacity = "Capacity is a whole number from 2 to 500.";
  }

  const bookingEmail = text(input.bookingEmail, 200).toLowerCase() || null;
  if (bookingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingEmail)) fields.bookingEmail = "That doesn’t look like an email address.";
  if (kind === "venue" && !bookingEmail) fields.bookingEmail = "An indoor venue needs a booking email, so requests can reach it.";

  const windows: PlaceInput["windows"] = [];
  const rawWindows = Array.isArray(input.windows) ? input.windows.slice(0, 21) : [];
  for (const w of rawWindows as Record<string, unknown>[]) {
    const weekday = Number(w?.weekday);
    const startTime = text(w?.startTime, 5);
    const endTime = text(w?.endTime, 5);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !TIME.test(startTime) || !TIME.test(endTime) || endTime <= startTime) {
      fields.windows = "Each standing window needs a day and a start time before its end time.";
      break;
    }
    windows.push({ weekday, startTime, endTime, autoApprove: w?.autoApprove === true });
  }

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    place: {
      name,
      address,
      postcodeDistrict: district!,
      kind: kind!,
      capacity,
      facilities: text(input.facilities, 300),
      stepFree: input.stepFree === true,
      priceText: text(input.priceText, 200) || null,
      termsText: text(input.termsText, 500) || null,
      bookingEmail,
      active: input.active !== false,
      windows,
    },
  };
}
