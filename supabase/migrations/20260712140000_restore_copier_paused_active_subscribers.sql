-- Users whose trial/subscription lapsed had copier_paused forced true, but resubscribe
-- did not clear it. Restore copier for anyone billing-active again.
UPDATE public.user_profiles p
SET copier_paused = false
FROM public.subscriptions s
WHERE s.user_id = p.user_id
  AND p.copier_paused = true
  AND s.status IN ('active', 'trialing')
  AND (
    s.trial_ends_at IS NULL
    OR s.trial_ends_at > now()
  );
