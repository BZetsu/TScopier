-- RPC: get_churned_users (expiry-aware)
--
-- Same result set as 20261124000000, but the "already has a pending code"
-- exclusion now only counts codes that can still be redeemed.
--
-- Why this rewrite: recovery codes gained an expires_at. Before expiry existed,
-- `used = false` meant "pending". Now an unused code can be dead (expired), and
-- counting dead codes would permanently hide a user from this list — within the
-- default 30 days every non-redeeming campaigned user would silently vanish,
-- which is exactly the cohort a second campaign is for.

create or replace function public.get_churned_users()
returns table (
  user_id uuid,
  display_name text,
  first_name text,
  last_name text,
  subscription_status text,
  plan text,
  current_period_end timestamptz,
  trial_ends_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    up.user_id,
    up.display_name,
    up.first_name,
    up.last_name,
    s.status as subscription_status,
    s.plan,
    s.current_period_end,
    s.trial_ends_at
  from user_profiles up
  left join subscriptions s on s.user_id = up.user_id
  left join subscription_extensions e
    on e.user_id = up.user_id
    and e.granted_at + make_interval(days => e.days) > now()
  where (
        s.status in ('canceled', 'past_due', 'incomplete', 'incomplete_expired')
     or (s.status = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at < now())
     or s.id is null
    )
    and e.id is null
    -- Exclude users holding a code that is still redeemable: unused AND not expired.
    -- NULL expires_at means "never expires" and counts as live.
    and up.user_id not in (
      select user_id
      from subscription_recovery_codes
      where used = false
        and (expires_at is null or expires_at > now())
    )
  order by coalesce(s.current_period_end, s.trial_ends_at, now()) nulls last;
$$;

grant execute on function public.get_churned_users() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261125000000',
  '20261125000000_get_churned_users_live_codes',
  array['-- 20261125000000_get_churned_users_live_codes']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
