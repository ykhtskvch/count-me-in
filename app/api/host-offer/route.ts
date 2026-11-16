// GAT-02: answer a hosting offer from the link in the email. The one-time token is the
// proof; it is only ever acted on from a button press (POST), never on opening the link,
// so mail scanners that follow links cannot accept on someone's behalf.
import { respondHostOffer } from "@/db/gatherings";
import { getDatabase, json, readJson, rejectCrossOrigin } from "@/db/runtime";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = await readJson<{ token?: unknown; accept?: unknown }>(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token) || typeof body?.accept !== "boolean") {
    return json({ error: "This link isn’t valid." }, 400);
  }
  const result = await respondHostOffer(await getDatabase(), token, body.accept);
  if (!result.ok) {
    return json(
      { error: result.reason === "expired" ? "This offer has passed to someone else. Thank you anyway." : "This link has already been used or isn’t valid." },
      410,
    );
  }
  return json(result);
}
