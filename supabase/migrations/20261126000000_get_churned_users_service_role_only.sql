-- Restrict get_churned_users() to the service role.
--
-- Why this exists: the function is SECURITY DEFINER and was created with the
-- default EXECUTE privilege, so it could be called through
-- POST /rest/v1/rpc/get_churned_users by `anon` and `authenticated`. That let
-- anyone — including signed-out visitors — read every churned user's display
-- name, first name, subscription status, plan, period end and trial dates.
--
-- The only caller is the admin-query Edge Function, which authenticates with the
-- service-role key, so revoking these privileges changes nothing for the product.
--
-- is_admin() is deliberately NOT added to the function body: it reads auth.uid(),
-- which is NULL under a service-role call, so the guard would return false for
-- the one legitimate caller. Privilege control is the correct mechanism here.

revoke execute on function public.get_churned_users() from PUBLIC;
revoke execute on function public.get_churned_users() from anon;
revoke execute on function public.get_churned_users() from authenticated;
grant execute on function public.get_churned_users() to service_role;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261126000000',
  '20261126000000_get_churned_users_service_role_only',
  array['-- 20261126000000_get_churned_users_service_role_only']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
