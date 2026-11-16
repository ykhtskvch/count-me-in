import { getActivity } from "@/db/activities";
import { getDatabase, getSession, json } from "@/db/runtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(request);
  const activity = await getActivity(await getDatabase(), id, {
    district: session?.person?.postcodeDistrict ?? null,
    personId: session?.person?.id ?? null,
  });
  if (!activity) return json({ error: "This activity isn’t available." }, 404);
  return json({ activity, signedIn: Boolean(session), needsWelcome: Boolean(session && !session.person) });
}
