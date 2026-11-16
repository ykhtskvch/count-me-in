// INT-01, INT-02: "Count me in" with rough times, and taking it back.
import { removeInterest, setInterest } from "@/db/activities";
import { openRoundIfReady, removeOpenVotes } from "@/db/rounds";
import { getDatabase, getSession, json, readJson, rejectCrossOrigin } from "@/db/runtime";
import { normalizeBringing, normalizeLevel, normalizeTimes } from "@/lib/catalogue";

async function signedInPerson(request: Request) {
  const session = await getSession(request);
  if (!session) return { error: json({ error: "Sign in to say Count me in." }, 401) };
  if (!session.person) return { error: json({ error: "Finish setting up your account first.", needsWelcome: true }, 403) };
  return { person: session.person };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const payload = await readJson<{ times?: unknown; level?: unknown; bringing?: unknown }>(request);
  const times = normalizeTimes(payload?.times);
  const who = await signedInPerson(request);
  if (who.error) return who.error;
  const db = await getDatabase();
  const ok = await setInterest(db, id, who.person.id, times, {
    level: normalizeLevel(payload?.level),
    bringing: normalizeBringing(payload?.bringing),
  });
  if (!ok) return json({ error: "This activity isn’t taking new interest right now." }, 409);
  // TIME-01: the interest that reaches the minimum opens the picking of evenings.
  const roundOpened = Boolean(await openRoundIfReady(db, id));
  return json({ counted: true, times, roundOpened });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const who = await signedInPerson(request);
  if (who.error) return who.error;
  const db = await getDatabase();
  await removeOpenVotes(db, id, who.person.id);
  await removeInterest(db, id, who.person.id);
  return json({ counted: false });
}
