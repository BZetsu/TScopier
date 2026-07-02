/*
  Backfill: users without an active/trialing subscription should not show a live copier.
  Pauses copier and clears worker listener leases for all non-admin inactive subscribers.
*/

UPDATE public.user_profiles p
SET copier_paused = true
FROM public.subscriptions s
WHERE s.user_id = p.user_id
  AND s.status NOT IN ('active', 'trialing')
  AND p.copier_paused = false
  AND p.is_admin = false;

DELETE FROM public.worker_session_leases l
USING public.subscriptions s
WHERE l.user_id = s.user_id
  AND s.status NOT IN ('active', 'trialing');
