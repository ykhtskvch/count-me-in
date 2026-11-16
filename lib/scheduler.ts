// The scheduler's call (backlog 0.4). Supabase Cron signs each call with a server-only
// key kept in Supabase Vault; the site checks the signature and that it is fresh.
// A browser session or a Supabase API key never authorises this endpoint.
export const TICK_PATH = "/api/internal/tick";
const MAX_SKEW_SECONDS = 300;

export function tickMessage(timestamp: string): string {
  return `count-me-in-tick-v1\nPOST\n${TICK_PATH}\n${timestamp}`;
}

export async function signTick(secret: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(tickMessage(timestamp)));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTick(request: Request, secret: unknown, now = Date.now()): Promise<boolean> {
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) return false;
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== TICK_PATH || url.search || request.headers.has("origin")) return false;
  const timestamp = request.headers.get("x-cmi-time") ?? "";
  const signature = request.headers.get("x-cmi-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(tickMessage(timestamp)));
}
