// The person's own settings (NTF-03, INT-03, NTF-04): whether their name may be shown,
// and whether they want the weekly email about new activities.
import { updateSettings, wantsDigest } from "@/db/account";
import { getDatabase, json, readJson, rejectCrossOrigin, requirePerson } from "@/db/runtime";

export async function GET(request: Request) {
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const p = who.person;
  const digest = await wantsDigest(await getDatabase(), p.id);
  return json({ displayName: p.displayName, postcodeDistrict: p.postcodeDistrict, showName: Boolean(p.showName), digest, role: p.role });
}

export async function PUT(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const who = await requirePerson(request);
  if ("error" in who) return who.error;
  const body = await readJson<{ showName?: unknown; digest?: unknown }>(request);
  const showName = typeof body?.showName === "boolean" ? body.showName : undefined;
  const digest = typeof body?.digest === "boolean" ? body.digest : undefined;
  if (showName === undefined && digest === undefined) return json({ error: "Invalid request." }, 400);
  await updateSettings(await getDatabase(), who.person.id, { showName, digest });
  return json({ showName, digest });
}
