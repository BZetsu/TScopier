-- RPC: get_churned_users
-- Returns users whose subscription has canceled, is past_due, trial-expired,
-- or who never subscribed — and who don't already have a live recovery extension.

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
    and up.user_id not in (select user_id from subscription_recovery_codes where used = false)
  order by coalesce(s.current_period_end, s.trial_ends_at, now()) nulls last;
$$;

grant execute on function public.get_churned_users() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261124000000',
  '20261124000000_get_churned_users_rpc',
  array['-- 20261124000000_get_churned_users_rpc']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
