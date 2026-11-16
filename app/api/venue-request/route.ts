// PLC-03: a venue answers a room request from the link in its email, without an account.
// GET only shows the request; only a button press (POST) answers it, so mail scanners
// that open links cannot accept or decline on the venue's behalf.
import { getDatabase, json, readJson, rejectCrossOrigin } from "@/db/runtime";
import { respondVenueRequest, viewVenueRequest } from "@/db/venues";

const MESSAGES = {
  invalid: "This link isn’t valid.",
  answered: "This request has already been answered. Thank you.",
  late: "Thank you. We didn’t hear back in time, so we asked another venue. Your answer has been noted.",
  cancelled: "The group no longer needs the room. Thank you anyway.",
} as const;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const view = /^[0-9a-f]{64}$/.test(token) ? await viewVenueRequest(await getDatabase(), token) : null;
  if (!view) return json({ error: MESSAGES.invalid }, 404);
  return json({ request: view });
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = await readJson<{ token?: unknown; approve?: unknown }>(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token) || typeof body?.approve !== "boolean") return json({ error: MESSAGES.invalid }, 400);
  const result = await respondVenueRequest(await getDatabase(), token, body.approve);
  if (!result.ok) return json({ error: MESSAGES[result.reason] }, 410);
  return json(result);
}
