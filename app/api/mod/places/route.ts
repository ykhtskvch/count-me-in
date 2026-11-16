// 5.1: the moderator's list of places.
import { listPlaces, savePlace } from "@/db/places";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";
import { normalizePlace } from "@/lib/place-input";

export async function GET(request: Request) {
  const mod = await requireModerator(request);
  if ("error" in mod) return mod.error;
  return json({ places: await listPlaces(await getDatabase()) });
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const mod = await requireModerator(request);
  if ("error" in mod) return mod.error;
  const input = normalizePlace(await readJson(request));
  if (!input.ok) return json({ error: "Please check the highlighted fields.", fields: input.fields }, 400);
  const id = await savePlace(await getDatabase(), mod.person.id, input.place);
  return json({ id }, 201);
}
