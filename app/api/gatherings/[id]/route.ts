// GAT-01: the gathering page's data. Counts only; the host's name only for people going.
import { getGathering } from "@/db/gatherings";
import { getDatabase, getSession, json } from "@/db/runtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(request);
  const gathering = await getGathering(await getDatabase(), id, session?.person?.id ?? null);
  if (!gathering) return json({ error: "This gathering isn’t available." }, 404);
  return json({ gathering, signedIn: Boolean(session) });
}
