// 5.1: edit a place, its standing windows, or switch it off.
import { savePlace } from "@/db/places";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";
import { normalizePlace } from "@/lib/place-input";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const mod = await requireModerator(request);
  if ("error" in mod) return mod.error;
  const { id } = await params;
  const input = normalizePlace(await readJson(request));
  if (!input.ok) return json({ error: "Please check the highlighted fields.", fields: input.fields }, 400);
  const saved = await savePlace(await getDatabase(), mod.person.id, input.place, id);
  if (!saved) return json({ error: "No such place." }, 404);
  return json({ id: saved });
}
