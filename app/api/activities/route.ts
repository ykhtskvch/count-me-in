import { listCatalogue } from "@/db/activities";
import { suggestCard } from "@/db/cards";
import { getDatabase, getSession, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";
import { normalizeCard } from "@/lib/card-input";

export async function GET(request: Request) {
  const session = await getSession(request);
  const district = session?.person?.postcodeDistrict ?? new URL(request.url).searchParams.get("district")?.toUpperCase() ?? null;
  const activities = await listCatalogue(await getDatabase(), { district, personId: session?.person?.id ?? null });
  return json({ activities, signedIn: Boolean(session), needsWelcome: Boolean(session && !session.person), district });
}

// CAT-03: anyone signed in suggests a card; a moderator's card is published at once (CAT-05).
export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const input = normalizeCard(await readJson(request));
  if (!input.ok) return json({ error: "Please check the highlighted fields.", fields: input.fields }, 400);
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const id = await suggestCard(await getDatabase(), who.person, input.card);
  return json({ id, published: who.person.role === "moderator" }, 201);
}
