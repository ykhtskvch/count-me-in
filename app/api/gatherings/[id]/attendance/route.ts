// GAT-03: join a gathering until it is full. GAT-04: leave at any time, no consequences.
import { joinGathering, leaveGathering } from "@/db/gatherings";
import { getDatabase, getSession, json, rejectCrossOrigin } from "@/db/runtime";

async function signedIn(request: Request) {
  const session = await getSession(request);
  if (!session) return { error: json({ error: "Sign in to join." }, 401) };
  if (!session.person) return { error: json({ error: "Finish setting up your account first.", needsWelcome: true }, 403) };
  return { person: session.person };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const who = await signedIn(request);
  if (who.error) return who.error;
  const result = await joinGathering(await getDatabase(), id, who.person.id);
  if (!result.ok) return json({ error: "This gathering is full or has already started." }, 409);
  return json({ going: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const who = await signedIn(request);
  if (who.error) return who.error;
  await leaveGathering(await getDatabase(), id, who.person.id);
  return json({ going: false });
}
