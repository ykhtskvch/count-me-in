// 8.4: a moderator cancels a gathering, with a reason kept in the log. Everyone going is emailed.
import { cancelGathering } from "@/db/gatherings";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const mod = await requireModerator(request);
  if ("error" in mod) return mod.error;
  const body = await readJson<{ reason?: unknown }>(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!reason) return json({ error: "Write a short reason. It stays in the moderation log.", fields: { reason: "Required." } }, 400);
  const { id } = await params;
  const done = await cancelGathering(await getDatabase(), id, "moderator", mod.person.id, reason);
  if (!done) return json({ error: "This gathering is not live any more." }, 409);
  return json({ cancelled: true });
}
