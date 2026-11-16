// The person's own settings (NTF-03, INT-03): whether their name may be shown.
import { updateSettings } from "@/db/account";
import { getDatabase, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";

export async function GET(request: Request) {
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const p = who.person;
  return json({ displayName: p.displayName, postcodeDistrict: p.postcodeDistrict, showName: Boolean(p.showName), role: p.role });
}

export async function PUT(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const body = await readJson<{ showName?: unknown }>(request);
  if (typeof body?.showName !== "boolean") return json({ error: "Invalid request." }, 400);
  await updateSettings(await getDatabase(), who.person.id, { showName: body.showName });
  return json({ showName: body.showName });
}
