import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PENDING_AUTH_COOKIE = "cmi_auth_pending";
const PENDING_MINUTES = 30;

type SupabaseBindings = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
};

export async function getSupabaseAuth(): Promise<SupabaseClient> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as SupabaseBindings;
  const url = bindings.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const publishableKey =
    bindings.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase Auth is not configured.");
  }

  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getSupabaseAdmin(options?: { fetch: typeof fetch }): Promise<SupabaseClient> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as SupabaseBindings;
  const url = bindings.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const secretKey = bindings.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase server access is not configured.");
  }

  return createClient(url, secretKey, {
    ...(options ? { global: { fetch: options.fetch } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function pendingAuthExpiry(): string {
  return new Date(Date.now() + PENDING_MINUTES * 60 * 1000).toISOString();
}

export function pendingAuthCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: PENDING_MINUTES * 60,
  };
}
