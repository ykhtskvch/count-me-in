// MOD-01/MOD-02: publish (with corrections) or reject with a set reason.
import { publishCard, rejectCard } from "@/db/cards";
import { getDatabase, json, readJson, rejectCrossOrigin, requireModerator } from "@/db/runtime";
import { normalizeCard, REJECTION_REASONS, type RejectionReason } from "@/lib/card-input";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  const { id } = await params;
  const body = await readJson<{ action?: unknown; reason?: unknown; edits?: unknown }>(request);
  const db = await getDatabase();
  if (body?.action === "publish") {
    let edits = null;
    if (body.edits) {
      const input = normalizeCard(body.edits);
      if (!input.ok) return json({ error: "Please check the highlighted fields.", fields: input.fields }, 400);
      edits = input.card;
    }
    return (await publishCard(db, m.person.id, id, edits)) ? json({ published: true }) : json({ error: "Already reviewed." }, 409);
  }
  if (body?.action === "reject" && typeof body.reason === "string" && body.reason in REJECTION_REASONS) {
    return (await rejectCard(db, m.person.id, id, body.reason as RejectionReason))
      ? json({ rejected: true })
      : json({ error: "Already reviewed." }, 409);
  }
  return json({ error: "Choose publish, or reject with a reason." }, 400);
}
