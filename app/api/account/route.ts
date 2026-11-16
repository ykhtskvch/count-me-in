// ACC-02, ACC-03: first sign-in. One self-entered name, "I am 18 or over", the rules,
// and the postcode district. Nothing else is asked for.
import { getDatabase, getSession, json, readJson, rejectCrossOrigin } from "@/db/runtime";
import { normalizeDisplayName, normalizePostcodeDistrict } from "@/lib/auth-input";
import { RULES_VERSION } from "@/lib/legal";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const payload = await readJson<{ displayName?: string; postcode?: string; adult?: boolean; rules?: boolean; showName?: boolean }>(request);
  const displayName = normalizeDisplayName(payload?.displayName ?? "");
  const district = normalizePostcodeDistrict(payload?.postcode ?? "");
  const errors: Record<string, string> = {};
  if (!displayName) errors.displayName = "Enter the name you’d like others to see, up to 40 characters.";
  if (!district) errors.postcode = "Enter the first part of your postcode, like E17 or SW9.";
  if (payload?.adult !== true) errors.adult = "Count Me In is for adults only.";
  if (payload?.rules !== true) errors.rules = "Please accept the rules to continue.";
  if (Object.keys(errors).length) return json({ error: "Please check the form.", fields: errors }, 400);

  const session = await getSession(request);
  if (!session) return json({ error: "Your sign-in has expired. Please sign in again." }, 401);
  if (session.person) return json({ error: "Your account is already set up." }, 409);

  const database = await getDatabase();
  const now = new Date().toISOString();
  await database
    .prepare(`INSERT INTO person (id, auth_user_id, display_name, postcode_district, adult_confirmed_at, rules_version, show_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), session.authUserId, displayName, district, now, RULES_VERSION, payload?.showName ? 1 : 0)
    .run();
  return json({ created: true }, 201);
}
