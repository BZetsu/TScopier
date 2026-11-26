import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Resolve auth e-mail addresses for a set of user ids.
 *
 * `listUsers` pages 1000 at a time and returns the newest first, so a single
 * page silently misses older accounts — which is exactly the churned cohort
 * this feature targets. Walk pages until every requested id is found or a short
 * page is reached.
 *
 * **Cap:** at most 10 pages (10,000 newest accounts). Beyond that the oldest
 * ids stay unresolved; the cap is warned about rather than passed over in
 * silence, because a partial result here reads as "no email on file" to the
 * caller. An unreadable page stops the walk for the same reason and is warned
 * about too.
 *
 * Shared by `admin-mutate` (sending recovery emails) and `admin-query`
 * (listing codes, audit logs, users and account details) so all of them use the
 * same paged lookup instead of drifting apart.
 */
export async function fetchAuthEmails(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter(Boolean));
  const found = new Map<string, string>();
  if (wanted.size === 0) return found;

  const MAX_PAGES = 10;
  for (let page = 1; page <= MAX_PAGES && found.size < wanted.size; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.warn(`fetchAuthEmails: page ${page} unreadable (${error.message}); ${wanted.size - found.size} id(s) unresolved`);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      if (wanted.has(u.id)) found.set(u.id, u.email ?? "");
    }
    if (users.length < 1000) break;
    if (page === MAX_PAGES && found.size < wanted.size) {
      console.warn(`fetchAuthEmails: stopped at the ${MAX_PAGES}-page cap with ${wanted.size - found.size} id(s) unresolved`);
    }
  }
  return found;
}
