// ACC-01: anyone can ask for a sign-in link; no password and no invitation.
import { NextResponse } from "next/server";
import { getSupabaseAuth, pendingAuthCookieOptions, pendingAuthExpiry, PENDING_AUTH_COOKIE } from "@/db/auth";
import { createToken, getDatabase, hashSecret, json, readCookie, readJson, rejectCrossOrigin } from "@/db/runtime";
import { normalizeEmail, normalizeReturnTo } from "@/lib/auth-input";

const LIMIT_PER_EMAIL_PER_HOUR = 4;
const LIMIT_PER_NETWORK_PER_HOUR = 20;

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const payload = await readJson<{ email?: string; returnTo?: string }>(request);
  const email = normalizeEmail(payload?.email ?? "");
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  const continuationPath = normalizeReturnTo(payload?.returnTo);

  const database = await getDatabase();
  const emailHash = await hashSecret(email);

  const clientAddress =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  const buckets: Array<[string, number]> = [
    [await hashSecret(`email:${emailHash}:${hour}`), LIMIT_PER_EMAIL_PER_HOUR],
    [await hashSecret(`ip:${clientAddress}:${hour}`), LIMIT_PER_NETWORK_PER_HOUR],
  ];
  const bucketExpiry = new Date(Date.now() + 65 * 60 * 1000).toISOString();
  await database.prepare("DELETE FROM auth_rate_limit WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  for (const [key, limit] of buckets) {
    const row = await database
      .prepare(`INSERT INTO auth_rate_limit (bucket_key, attempts, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET attempts = attempts + 1
        RETURNING attempts`)
      .bind(key, bucketExpiry)
      .first<{ attempts: number }>();
    if ((row?.attempts ?? limit + 1) > limit) {
      return json({ error: "Too many sign-in emails were requested. Please try again in an hour." }, 429);
    }
  }

  await database.prepare("DELETE FROM pending_auth_request WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  const previous = readCookie(request, PENDING_AUTH_COOKIE);
  if (previous) {
    await database.prepare("DELETE FROM pending_auth_request WHERE browser_token_hash = ?").bind(await hashSecret(previous)).run();
  }

  const pendingToken = createToken();
  const pendingId = crypto.randomUUID();
  await database
    .prepare(`INSERT INTO pending_auth_request (id, browser_token_hash, email_hash, continuation_path, expires_at)
      VALUES (?, ?, ?, ?, ?)`)
    .bind(pendingId, await hashSecret(pendingToken), emailHash, continuationPath, pendingAuthExpiry())
    .run();

  // The pending token travels in the link too, so it works when Mail opens it in another browser.
  const redirectTo = new URL("/auth/confirm", request.url);
  redirectTo.searchParams.set("pending", pendingToken);

  try {
    const supabase = await getSupabaseAuth();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo.toString(), shouldCreateUser: true },
    });
    if (error) throw error;
  } catch (error) {
    await database.prepare("DELETE FROM pending_auth_request WHERE id = ?").bind(pendingId).run();
    console.error("Unable to request Supabase magic link", error);
    return json({ error: "We couldn’t send the sign-in email. Please try again shortly." }, 502);
  }

  const response = NextResponse.json({ sent: true }, { status: 202 });
  response.cookies.set(PENDING_AUTH_COOKIE, pendingToken, pendingAuthCookieOptions(request));
  return response;
}
