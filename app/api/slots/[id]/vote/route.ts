// TIME-02/TIME-03: "I can make it" on one of the offered evenings, and taking it back.
import { voteSlot } from "@/db/rounds";
import { getDatabase, getSession, json, rejectCrossOrigin } from "@/db/runtime";

async function vote(request: Request, params: Promise<{ id: string }>, canMake: boolean) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { id } = await params;
  const session = await getSession(request);
  if (!session) return json({ error: "Sign in to pick an evening." }, 401);
  if (!session.person) return json({ error: "Finish setting up your account first.", needsWelcome: true }, 403);
  const result = await voteSlot(await getDatabase(), id, session.person.id, canMake);
  if (!result.ok) return json({ error: "Picking for this evening has closed." }, 409);
  return json({ canMake, gathering: result.gatheringId });
}

export function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return vote(request, params, true);
}

export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return vote(request, params, false);
}
