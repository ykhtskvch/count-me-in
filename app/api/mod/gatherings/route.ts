// 8.4: live gatherings for the moderator.
import { listLiveGatherings } from "@/db/places";
import { getDatabase, json, requireModerator } from "@/db/runtime";

export async function GET(request: Request) {
  const mod = await requireModerator(request);
  if ("error" in mod) return mod.error;
  return json({ gatherings: await listLiveGatherings(await getDatabase()) });
}
