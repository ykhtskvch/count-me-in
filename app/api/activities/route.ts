import { listCatalogue } from "@/db/activities";
import { getDatabase, getSession, json } from "@/db/runtime";

export async function GET(request: Request) {
  const session = await getSession(request);
  const district = session?.person?.postcodeDistrict ?? new URL(request.url).searchParams.get("district")?.toUpperCase() ?? null;
  const activities = await listCatalogue(await getDatabase(), { district, personId: session?.person?.id ?? null });
  return json({ activities, signedIn: Boolean(session), needsWelcome: Boolean(session && !session.person), district });
}
