// The PRD's metrics for the moderator.
import { computeMetrics } from "@/db/metrics";
import { getDatabase, json, requireModerator } from "@/db/runtime";

export async function GET(request: Request) {
  const m = await requireModerator(request);
  if ("error" in m) return m.error;
  return json({ metrics: await computeMetrics(await getDatabase()) });
}
