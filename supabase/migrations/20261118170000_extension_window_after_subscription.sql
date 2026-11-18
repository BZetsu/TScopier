-- A grant given to a paying customer must start when their paid period ends.
--
-- 20261118130000 taught user_effective_plan_for_limits() about extensions, but anchored
-- every grant at granted_at. An admin granting 7 days to a customer with 10 days of paid
-- access left them nothing after the grant had silently run during the paid period.
--
-- New rule: a grant window starts at the later of granted_at and the end of the paid
-- period (current_period_end) or trial (trial_ends_at); it lasts `days` from that start.
-- A paid or trialing subscription still answers with its own plan while it is running, so
-- a grant never upgrades someone who is still paying.
--
-- This function feeds user_broker_account_limit() and user_telegram_channel_limit(), so
-- both triggers move together.

create or replace function public.user_effective_plan_for_limits(p_user_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with s as (
    select plan, status, trial_ends_at, current_period_end
    from public.subscriptions
    where user_id = p_user_id
    limit 1
  ),
  paid as (
    select
      case
        when s.status = 'active' then s.plan
        when s.status = 'trialing'
          and (s.trial_ends_at is null or s.trial_ends_at > now()) then s.plan
        else null
      end as plan,
      -- Read the end regardless of the status: the Stripe webhook flips to
      -- 'canceled' and keeps current_period_end, and discarding it there made a
      -- grant expire unused on the ordinary cancellation path.
      coalesce(s.current_period_end, s.trial_ends_at) as sub_end,
      coalesce(s.status in ('active', 'trialing'), false) as running
    from (select 1) as dummy
    left join s on true
  )
  select coalesce(
    (select paid.plan from paid),
    case
      when exists (
        select 1
        from public.subscription_extensions e
        cross join paid
        where e.user_id = p_user_id
          and e.days > 0
          -- Still paying with time left: queue the grant at the period end.
          -- Otherwise the paid access is over: start at that end, never later than now.
          and greatest(
                e.granted_at,
                case
                  when paid.running and paid.sub_end > now() then paid.sub_end
                  when paid.sub_end is not null then least(paid.sub_end, now())
                  else '-infinity'::timestamptz
                end
              ) + make_interval(days => e.days) > now()
      ) then 'advanced'
      else null
    end
  );
$function$;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261118170000',
  '20261118170000_extension_window_after_subscription',
  array['-- 20261118170000_extension_window_after_subscription']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
