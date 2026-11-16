// MOD-04: hide a card from the catalogue; its gathering, if any, is cancelled.
import { hideCard } from "@/db/cards";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  const { id } = await params;
  const body = await readJson<{ note?: unknown }>(request);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null;
  return (await hideCard(await getDatabase(), m.person.id, id, note)) ? json({ hidden: true }) : json({ error: "Already hidden." }, 409);
}
