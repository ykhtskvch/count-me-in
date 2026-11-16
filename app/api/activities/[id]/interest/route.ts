// INT-01, INT-02: "Count me in" with rough times, and taking it back.
import { removeInterest, setInterest } from "@/db/activities";
import { getDatabase, getSession, json, readJson, rejectCrossOrigin } from "@/db/runtime";
import { normalizeTimes } from "@/lib/catalogue";

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
  const payload = await readJson<{ times?: unknown }>(request);
  const times = normalizeTimes(payload?.times);
  const who = await signedInPerson(request);
  if (who.error) return who.error;
  const ok = await setInterest(await getDatabase(), id, who.person.id, times);
  if (!ok) return json({ error: "This activity isn’t taking new interest right now." }, 409);
  return json({ counted: true, times });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const who = await signedInPerson(request);
  if (who.error) return who.error;
  await removeInterest(await getDatabase(), id, who.person.id);
  return json({ counted: false });
}
