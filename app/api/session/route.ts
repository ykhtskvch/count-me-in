import { NextResponse } from "next/server";
import { getDatabase, getSession, hashSecret, json, readCookie, rejectCrossOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/db/runtime";

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return json({ authenticated: false }, 401);
  return json({
    authenticated: true,
    needsWelcome: !session.person,
    person: session.person && { displayName: session.person.displayName, postcodeDistrict: session.person.postcodeDistrict, role: session.person.role },
  });
}

export async function DELETE(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const database = await getDatabase();
    await database.prepare("DELETE FROM session WHERE token_hash = ?").bind(await hashSecret(token)).run();
  }
  const response = NextResponse.json({ signedOut: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(request, 0));
  return response;
}
