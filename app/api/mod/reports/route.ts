// MOD-03/MOD-04: open reports, and closing them by dismissing, hiding the card or blocking.
import { openReports, resolveReports } from "@/db/reports";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";

export async function GET(request: Request) {
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  return json({ reports: await openReports(await getDatabase()) });
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  const body = await readJson<{ targetKind?: unknown; targetId?: unknown; action?: unknown; note?: unknown }>(request);
  const kind = body?.targetKind === "activity" || body?.targetKind === "person" ? body.targetKind : null;
  const action = body?.action === "dismiss" || body?.action === "hide" || body?.action === "block" ? body.action : null;
  if (!kind || typeof body?.targetId !== "string" || !action) return json({ error: "Invalid request." }, 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null;
  const done = await resolveReports(await getDatabase(), m.person.id, { kind, id: body.targetId }, action, note);
  return done ? json({ resolved: true }) : json({ error: "That action doesn’t fit this report." }, 409);
}
