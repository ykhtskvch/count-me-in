// MOD-03: report a card with one button. Only moderators see reports.
import { createReport } from "@/db/reports";
import { getDatabase, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const { id } = await params;
  const body = await readJson<{ text?: unknown }>(request);
  const db = await getDatabase();
  const exists = await db.prepare("SELECT 1 AS ok FROM activity WHERE id = ?1 AND state <> 'removed'").bind(id).first();
  if (!exists) return json({ error: "This activity isn’t available." }, 404);
  await createReport(db, who.person.id, { kind: "activity", id }, typeof body?.text === "string" ? body.text : "");
  return json({ reported: true });
}
