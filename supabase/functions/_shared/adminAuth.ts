import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { loadUserIsAdmin } from "./subscriptionAccess.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function requireAuthedAdmin(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ user: User } | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders }) };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  const user = authData?.user ?? null;
  if (authErr || !user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders }) };
  }
  const isAdmin = await loadUserIsAdmin(supabase, user.id);
  if (!isAdmin) {
    return { error: Response.json({ error: "Admin access required" }, { status: 403, headers: corsHeaders }) };
  }
  return { user };
}
