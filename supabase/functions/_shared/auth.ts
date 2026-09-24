declare const Deno: {
  env: { get(key: string): string | undefined };
};

// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type AuthedCaller = {
  id: string;
  email: string | null;
  role: string | null;
};

/**
 * Resolve the caller from their Supabase session JWT.
 *
 * Returns `null` for anything that is not a valid user token — including the
 * publishable/anon key, which is not a user credential. Callers must translate
 * `null` into a generic 401 without echoing why the check failed.
 */
export async function resolveCaller(req: Request): Promise<AuthedCaller | null> {
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("[auth] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    return null;
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    role: (roleRow?.role as string | undefined) ?? null,
  };
}
