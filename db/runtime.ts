// Request helpers shared by the API routes: D1 access, hashing, cookies and the session.
// Adapted from the Street Noticeboard's db/runtime.ts.

export const SESSION_COOKIE = "cmi_session";
const SESSION_DAYS = 30;

export type Person = {
  id: string;
  displayName: string;
  postcodeDistrict: string;
  showName: number;
  role: "participant" | "moderator";
};

export type Session = {
  authUserId: string;
  /** null until the first-sign-in form at /welcome is done. */
  person: Person | null;
};

export async function getDatabase(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("D1 binding `DB` is unavailable.");
  return database;
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function sessionCookieOptions(request: Request, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge,
  };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  return null;
}

export async function getSession(request: Request): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT session.auth_user_id AS authUserId,
        person.id, person.display_name AS displayName, person.postcode_district AS postcodeDistrict,
        person.show_name AS showName, person.role, person.blocked_at AS blockedAt
      FROM session
      LEFT JOIN person ON person.auth_user_id = session.auth_user_id
      WHERE session.token_hash = ? AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      LIMIT 1`)
    .bind(await hashSecret(token))
    .first<{ authUserId: string; id: string | null; displayName: string; postcodeDistrict: string; showName: number; role: Person["role"]; blockedAt: string | null }>();
  if (!row) return null;
  if (row.blockedAt) return null; // MOD-04: a blocked account cannot sign in
  const person = row.id
    ? { id: row.id, displayName: row.displayName, postcodeDistrict: row.postcodeDistrict, showName: row.showName, role: row.role }
    : null;
  return { authUserId: row.authUserId, person };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Moderator-only routes: 401 when signed out, 403 for everyone who is not a moderator. */
export async function requireModerator(request: Request): Promise<{ person: Person } | { error: Response }> {
  const session = await getSession(request);
  if (!session?.person) return { error: json({ error: "Sign in as a moderator." }, 401) };
  if (session.person.role !== "moderator") return { error: json({ error: "Only moderators can do this." }, 403) };
  return { person: session.person };
}

/** Routes for people with a finished account: 401 when signed out, 403 until /welcome is done. */
export async function requirePerson(request: Request): Promise<{ person: Person; authUserId: string } | { error: Response }> {
  const session = await getSession(request);
  if (!session) return { error: json({ error: "Please sign in first." }, 401) };
  if (!session.person) return { error: json({ error: "Finish setting up your account first.", needsWelcome: true }, 403) };
  return { person: session.person, authUserId: session.authUserId };
}
