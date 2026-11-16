// GAT-07: the two questions after a gathering, answered from the email link without signing in.
import { answerFollowup, viewFollowup } from "@/db/followups";
import { getDatabase, json, readJson, rejectCrossOrigin } from "@/db/runtime";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const view = /^[0-9a-f]{64}$/.test(token) ? await viewFollowup(await getDatabase(), token) : null;
  return view ? json({ followup: view }) : json({ error: "This link isn’t valid." }, 404);
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = await readJson<{ token?: unknown; happened?: unknown; again?: unknown }>(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token) || typeof body?.happened !== "boolean" || typeof body?.again !== "boolean") {
    return json({ error: "Please answer both questions." }, 400);
  }
  const result = await answerFollowup(await getDatabase(), token, { happened: body.happened, again: body.again });
  if (result === "invalid") return json({ error: "This link isn’t valid." }, 404);
  return json({ saved: true, already: result === "already" });
}
