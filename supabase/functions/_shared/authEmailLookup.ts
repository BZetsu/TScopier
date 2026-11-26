import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Resolve auth e-mail addresses for a set of user ids.
 *
 * `listUsers` pages 1000 at a time and returns the newest first, so a single
 * page silently misses older accounts — which is exactly the churned cohort
 * this feature targets. Walk pages until every requested id is found or a short
 * page is reached.
 *
 * Shared by `admin-mutate` (sending recovery emails) and `admin-query`
 * (listing codes, audit logs and account details) so all three use the same
 * paged lookup instead of drifting apart.
 */
export async function fetchAuthEmails(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter(Boolean));
  const found = new Map<string, string>();
  if (wanted.size === 0) return found;

  for (let page = 1; page <= 10 && found.size < wanted.size; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = data?.users ?? [];
    for (const u of users) {
      if (wanted.has(u.id)) found.set(u.id, u.email ?? "");
    }
    if (users.length < 1000) break;
  }
  return found;
}
