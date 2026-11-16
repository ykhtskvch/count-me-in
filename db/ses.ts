// Amazon SES over plain fetch with SigV4 signing. Copied from the Street Noticeboard's db/ses.ts.
export type SesBindings = {
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  AWS_REGION?: string;
  SES_FROM_EMAIL?: string;
};

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
async function hmac(key: ArrayBuffer, value: string) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}
const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

// Shared HTTP-only SigV4 request construction. No credentials in URLs, redirects,
// implicit SDK retries, arbitrary hosts, queries or request/body logging.
export async function buildSesRequest(bindings: SesBindings, method: "GET" | "POST", path: string, body = "", now = new Date()) {
  const region = bindings.AWS_REGION ?? "eu-west-2";
  if (!bindings.AWS_ACCESS_KEY_ID || !bindings.AWS_SECRET_ACCESS_KEY
    || !/^[a-z]{2}-(?:[a-z]+-){1,2}\d$/.test(region) || region.startsWith("cn-")
    || !path.startsWith("/v2/email/") || /[?#\s]|(?:^|\/)\.\.(?:\/|$)/.test(path)
    || !Number.isFinite(now.getTime()) || (method === "GET" && body)) throw new Error("SES request configuration is incomplete.");
  const host = `email.${region}.amazonaws.com`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amzDate.slice(0, 8);
  const payloadHash = await digest(body);
  const session = bindings.AWS_SESSION_TOKEN ? `x-amz-security-token:${bindings.AWS_SESSION_TOKEN}\n` : "";
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n${session}`;
  const signedHeaders = `content-type;host;x-amz-content-sha256;x-amz-date${session ? ";x-amz-security-token" : ""}`;
  // SES uses normal SigV4 path double-encoding, unlike S3. The actual URL has
  // the once-encoded recipient segment; canonicalization encodes '%' again.
  const canonicalPath = path.split("/").map(uriEncode).join("/");
  const canonical = `${method}\n${canonicalPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${day}/${region}/ses/aws4_request`;
  let key = encoder.encode(`AWS4${bindings.AWS_SECRET_ACCESS_KEY}`).buffer as ArrayBuffer;
  for (const value of [day, region, "ses", "aws4_request"]) key = await hmac(key, value);
  const signature = hex(await hmac(key, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await digest(canonical)}`));
  const headers: Record<string, string> = {
    "content-type": "application/json", "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${bindings.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (bindings.AWS_SESSION_TOKEN) headers["x-amz-security-token"] = bindings.AWS_SESSION_TOKEN;
  // Workers rejects redirect:"error" before making a request. Manual mode is
  // supported and never forwards signed credentials to a redirect destination.
  return { url: `https://${host}${path}`, init: { method, headers, ...(method === "POST" ? { body } : {}), redirect: "manual" as const } };
}

export async function sesRequest(bindings: SesBindings, method: "GET" | "POST", path: string, body = "", signal?: AbortSignal) {
  const request = await buildSesRequest(bindings, method, path, body);
  const response = await fetch(request.url, { ...request.init, signal });
  if (response.status >= 300 && response.status < 400) throw new Error("Amazon SES redirects are not allowed.");
  return response;
}

export function sesErrorName(response: Response, data: unknown): string | null {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const raw = response.headers.get("x-amzn-errortype") ?? record.__type ?? record.code;
  if (typeof raw !== "string") return null;
  const name = raw.split(":")[0].split("#").at(-1)!;
  return /^[a-zA-Z]{1,100}$/.test(name) ? name : null;
}

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

export async function sendSesEmail(message: OutgoingEmail, bindings: SesBindings & { SES_FROM_EMAIL?: string }): Promise<string | null> {
  if (!bindings.SES_FROM_EMAIL || !message.to) throw new Error("SES sender or recipient is missing.");
  const body = JSON.stringify({
    FromEmailAddress: bindings.SES_FROM_EMAIL,
    Destination: { ToAddresses: [message.to] },
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: { Text: { Data: message.text, Charset: "UTF-8" }, Html: { Data: message.html, Charset: "UTF-8" } },
      },
    },
  });
  const response = await sesRequest(bindings, "POST", "/v2/email/outbound-emails", body);
  const result = (await response.json().catch(() => ({}))) as { MessageId?: string; message?: string };
  if (!response.ok) throw new Error(sesErrorName(response, result) ?? `Amazon SES returned ${response.status}.`);
  return result.MessageId ?? null;
}
