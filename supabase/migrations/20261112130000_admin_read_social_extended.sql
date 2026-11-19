/*
  Admin read access for the extended social trading monitoring tables
  (Social Trading page: copied-trade ledger, billing, provider directory).

  Builds on 20261110120000 (applied 2026-11-12 to staging + prod): that
  migration covered subscriptions/sources/events, broker copy links, mirror
  link state/events, TradingView, WhatsApp and Discord. This one adds the
  tables a complete monitoring view still cannot see: the per-copy trade
  ledgers (social + mirror), mirror master state, Stripe copy billing,
  provider directory profiles, follow relationships, reviews, and wallet
  ledger/payouts.

  SELECT only — SECURITY DEFINER public.is_admin() helper (20260529211209);
  a subquery against user_profiles would recurse under RLS. Writes stay with
  the product's security-definer RPCs.

  Two of these tables were created with SELECT revoked from app roles
  (social_trader_reviews: insert/update/delete only; mirror_copy_master_state:
  service_role only) — a policy alone cannot grant the privilege, so this
  migration grants SELECT on those two to authenticated first. Measured on
  prod 2026-11-13: has_table_privilege('authenticated', ..., 'SELECT') = false
  for exactly these two; all other listed tables already have SELECT.
*/

GRANT SELECT ON public.social_trader_reviews TO authenticated;
GRANT SELECT ON public.mirror_copy_master_state TO authenticated;

CREATE POLICY "Admins can view social_copy_trade_mappings"
  ON public.social_copy_trade_mappings FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view mirror_copy_trade_mappings"
  ON public.mirror_copy_trade_mappings FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view mirror_copy_master_state"
  ON public.mirror_copy_master_state FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_copy_billing"
  ON public.social_copy_billing FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_profiles"
  ON public.social_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_follow_relationships"
  ON public.social_follow_relationships FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view social_trader_reviews"
  ON public.social_trader_reviews FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view wallet_ledger"
  ON public.wallet_ledger FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can view user_wallets"
  ON public.user_wallets FOR SELECT
  TO authenticated
  USING (public.is_admin());
