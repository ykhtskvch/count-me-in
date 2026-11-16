// ACC-02, ACC-03: first sign-in. One self-entered name, "I am 18 or over", the rules,
// and the postcode district. Nothing else is asked for.
import { deleteAccount } from "@/db/account";
import { getSupabaseAdmin } from "@/db/auth";
import { SESSION_COOKIE, getDatabase, getSession, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";
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

// ACC-04: delete the account. Everything Count Me In holds about the person goes, and the
// email address is deleted from Supabase Auth too. Typing DELETE guards against a slip.
export async function DELETE(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = await readJson<{ confirm?: unknown }>(request);
  if (body?.confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const deleted = await deleteAccount(await getDatabase(), who.person.id);
  if (!deleted) return json({ error: "A moderator account can’t delete itself. Ask another moderator to make you a participant first." }, 409);
  try {
    const admin = await getSupabaseAdmin();
    await admin.auth.admin.deleteUser(deleted.authUserId);
  } catch {
    // The Count Me In data is already gone; the sign-in record is retried by hand if this fails.
    console.error("Supabase user deletion failed");
  }
  const response = json({ deleted: true });
  response.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return response;
}
