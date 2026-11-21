-- Access extensions must count at the database level too.
--
-- The edge functions learned about `subscription_extensions` in 13fb014d, but two
-- table triggers still enforced plan limits through
-- `public.user_effective_plan_for_limits()`, which only recognised an active paid
-- subscription or a live trial. A user kept alive by an admin grant therefore got
-- a plan of NULL, a broker limit of 0, and the trigger rejected the insert with
-- "subscription_required: An active subscription is required to connect broker
-- accounts." — even though the edge function had already allowed it.
--
-- This function feeds both `user_broker_account_limit()` and
-- `user_telegram_channel_limit()`, so fixing it here fixes both triggers.
--
-- Rule: keep the paid/trial answer first; when that is NULL, a live grant gives
-- the customer Advanced — the same answer the edge functions and the trade
-- worker now give for a granted account.

create or replace function public.user_effective_plan_for_limits(p_user_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with sub as (
    select s.plan, s.status, s.trial_ends_at
    from public.subscriptions s
    where s.user_id = p_user_id
    limit 1
  )
  select coalesce(
    (select case
       when sub.status = 'active' then sub.plan
       when sub.status = 'trialing'
         and (sub.trial_ends_at is null or sub.trial_ends_at > now()) then sub.plan
       else null
     end
     from sub),
    case
      when exists (
        select 1
        from public.subscription_extensions e
        where e.user_id = p_user_id
          and e.granted_at + make_interval(days => e.days) > now()
      ) then 'advanced'
      else null
    end
  );
$function$;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261118130000',
  '20261118130000_subscription_extensions_plan_limits',
  array['-- 20261118130000_subscription_extensions_plan_limits']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
