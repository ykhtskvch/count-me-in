import { getActivity } from "@/db/activities";
import { activeGatheringId } from "@/db/gatherings";
import { getOpenRound } from "@/db/rounds";
import { getDatabase, getSession, json } from "@/db/runtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(request);
  const db = await getDatabase();
  const activity = await getActivity(db, id, {
    district: session?.person?.postcodeDistrict ?? null,
    personId: session?.person?.id ?? null,
  });
  if (!activity) return json({ error: "This activity isn’t available." }, 404);
  const round = activity.state === "choosing" ? await getOpenRound(db, id, session?.person?.id ?? null) : null;
  const gatheringId = ["awaiting_place", "scheduled", "choosing"].includes(activity.state) ? await activeGatheringId(db, id) : null;
  return json({ activity, round, gatheringId, signedIn: Boolean(session), needsWelcome: Boolean(session && !session.person) });
}
