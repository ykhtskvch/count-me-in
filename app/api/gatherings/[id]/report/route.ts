// MOD-03: report the host of a gathering you are going to. The host is the only other
// person a participant ever sees by name.
import { createReport, hostOf } from "@/db/reports";
import { getDatabase, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const { id } = await params;
  const body = await readJson<{ text?: unknown }>(request);
  const db = await getDatabase();
  const host = await hostOf(db, id, who.person.id);
  if (!host) return json({ error: "There is no one to report here." }, 404);
  await createReport(db, who.person.id, { kind: "person", id: host }, typeof body?.text === "string" ? body.text : "");
  return json({ reported: true });
}
