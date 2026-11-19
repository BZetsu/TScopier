/*
  Admin read access for the social trading monitoring tables.

  Powers the admin Social Trading page and the user-profile additions
  (WhatsApp / Discord / TradingView connectivity, mirror Master/Slave pills,
  cTrader column): copy subscriptions, sources and execution events; broker
  copy links with mirror link state and mirror execution events; WhatsApp
  sessions; Discord installations; TradingView webhooks and deliveries.

  SELECT only — uses the SECURITY DEFINER is_admin() helper (see
  20260529211209_fix_admin_rls_security_definer.sql); a subquery against
  user_profiles would recurse under RLS and always fail. Writes are NOT
  granted here. Without these policies PostgREST silently returns zero rows
  under RLS, so the pages would render as "no data" with no error.
*/

CREATE POLICY "Admins can view social_copy_subscriptions"
  ON public.social_copy_subscriptions FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_copy_sources"
  ON public.social_copy_sources FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_copy_execution_events"
  ON public.social_copy_execution_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view broker_copy_links"
  ON public.broker_copy_links FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view mirror_copy_link_state"
  ON public.mirror_copy_link_state FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view mirror_copy_execution_events"
  ON public.mirror_copy_execution_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view tradingview_webhooks"
  ON public.tradingview_webhooks FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view tradingview_webhook_deliveries"
  ON public.tradingview_webhook_deliveries FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view whatsapp_sessions"
  ON public.whatsapp_sessions FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view discord_installations"
  ON public.discord_installations FOR SELECT
  TO authenticated
  USING (public.is_admin());
