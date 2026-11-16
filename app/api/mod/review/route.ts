// MOD-01: cards waiting for review.
import { reviewQueue } from "@/db/cards";
import { getDatabase, json, requireModerator } from "@/db/runtime";

export async function GET(request: Request) {
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  return json({ cards: await reviewQueue(await getDatabase()) });
}
