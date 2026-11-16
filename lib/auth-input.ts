// Pure input checks for sign-in and first sign-in (ACC-01..03). No I/O here, so it is unit-tested.

export const NAME_MAX = 40;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** A same-site path to return to after sign-in, or null. Blocks "//host" and absolute URLs. */
export function normalizeReturnTo(value: string | undefined | null): string | null {
  const path = value?.trim() ?? "";
  if (!path || path.length > 2048 || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const parsed = new URL(path, "https://count-me-in.invalid");
    if (parsed.origin !== "https://count-me-in.invalid") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** One self-entered name: trimmed, inner spaces collapsed, 1..40 characters. */
export function normalizeDisplayName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (/[<>@]/.test(name)) return null; // not an email or markup
  return name;
}

const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const INWARD = /^[0-9][A-Z]{2}$/;

/**
 * The postcode district (first half of a UK postcode), e.g. "E17" or "SW9".
 * Accepts a district or a full postcode and keeps only the first half, so the
 * full postcode is never stored (ACC-03).
 */
export function normalizePostcodeDistrict(value: string): string | null {
  const compact = value.toUpperCase().replace(/\s+/g, "");
  if (OUTWARD.test(compact)) return compact;
  if (compact.length >= 5 && INWARD.test(compact.slice(-3))) {
    const outward = compact.slice(0, -3);
    if (OUTWARD.test(outward)) return outward;
  }
  return null;
}
