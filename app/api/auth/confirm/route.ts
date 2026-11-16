// Second step of the magic link. A person clicks a button on /auth/confirm, so an
// email scanner that opens the link does not sign anyone in.
import { NextResponse } from "next/server";
import { getSupabaseAuth, pendingAuthCookieOptions, PENDING_AUTH_COOKIE } from "@/db/auth";
import {
  createToken,
  getDatabase,
  hashSecret,
  json,
  readCookie,
  readJson,
  rejectCrossOrigin,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionExpiry,
} from "@/db/runtime";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const payload = await readJson<{ pending?: string; tokenHash?: string; accessToken?: string; type?: string }>(request);
  const pendingToken = payload?.pending || readCookie(request, PENDING_AUTH_COOKIE) || "";
  const tokenHash = payload?.tokenHash?.trim() ?? "";
  const accessToken = payload?.accessToken?.trim() ?? "";
  if (!pendingToken || (!tokenHash && !accessToken) || (tokenHash && payload?.type !== "email")) {
    return json({ error: "This sign-in link is incomplete. Request a new email and try again." }, 400);
  }

  const database = await getDatabase();
  const pending = await database
    .prepare(`SELECT id, email_hash AS emailHash, continuation_path AS continuationPath
      FROM pending_auth_request
      WHERE browser_token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      LIMIT 1`)
    .bind(await hashSecret(pendingToken))
    .first<{ id: string; emailHash: string; continuationPath: string | null }>();
  if (!pending) {
    return json({ error: "This sign-in request has expired. Ask for a new link." }, 410);
  }

  let authUserId = "";
  let verifiedEmail = "";
  try {
    const supabase = await getSupabaseAuth();
    const { data, error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
      : await supabase.auth.getUser(accessToken);
    if (error || !data.user?.id || !data.user.email) throw error ?? new Error("Missing verified user");
    authUserId = data.user.id;
    verifiedEmail = data.user.email.trim().toLowerCase();
  } catch (error) {
    console.error("Unable to verify Supabase magic link", error);
    return json({ error: "This sign-in link is invalid or has expired. Request a new one." }, 400);
  }

  await database.prepare("DELETE FROM pending_auth_request WHERE id = ?").bind(pending.id).run();
  if ((await hashSecret(verifiedEmail)) !== pending.emailHash) {
    return json({ error: "The verified email does not match this request." }, 403);
  }

  const person = await database
    .prepare("SELECT id, blocked_at AS blockedAt FROM person WHERE auth_user_id = ? LIMIT 1")
    .bind(authUserId)
    .first<{ id: string; blockedAt: string | null }>();
  if (person?.blockedAt) {
    return json({ error: "This account can’t sign in. Contact the moderator if you think this is a mistake." }, 403);
  }

  const sessionToken = createToken();
  await database
    .prepare("INSERT INTO session (token_hash, auth_user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await hashSecret(sessionToken), authUserId, sessionExpiry())
    .run();

  const destination = pending.continuationPath ?? "/";
  const returnTo = person ? destination : `/welcome?next=${encodeURIComponent(destination)}`;
  const response = NextResponse.json({ authenticated: true, returnTo });
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(request));
  response.cookies.set(PENDING_AUTH_COOKIE, "", { ...pendingAuthCookieOptions(request), maxAge: 0 });
  return response;
}
