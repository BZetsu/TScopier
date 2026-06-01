-- Audit helpers for durable trade-channel attribution quality.
-- These views help track unlinked attribution over time and inspect exact rows.

-- Daily attribution quality per user.
CREATE OR REPLACE VIEW public.v_trade_channel_attribution_quality_daily AS
SELECT
  tca.user_id,
  (COALESCE(t.closed_at, t.opened_at, t.created_at))::date AS trade_day,
  COUNT(*)::bigint AS total_trades,
  COUNT(*) FILTER (
    WHERE tca.channel_id IS NOT NULL
      AND lower(trim(coalesce(tca.channel_label, ''))) <> 'unlinked / manual'
  )::bigint AS linked_trades,
  COUNT(*) FILTER (
    WHERE tca.channel_id IS NULL
      OR lower(trim(coalesce(tca.channel_label, ''))) = 'unlinked / manual'
  )::bigint AS unlinked_trades,
  ROUND(
    (
      COUNT(*) FILTER (
        WHERE tca.channel_id IS NULL
          OR lower(trim(coalesce(tca.channel_label, ''))) = 'unlinked / manual'
      )::numeric
      / NULLIF(COUNT(*), 0)::numeric
    ) * 100,
    2
  ) AS unlinked_pct
FROM public.trade_channel_attributions tca
LEFT JOIN public.trades t
  ON t.id = tca.trade_id
GROUP BY
  tca.user_id,
  (COALESCE(t.closed_at, t.opened_at, t.created_at))::date;

-- Detailed list of trades still unlinked/manual for diagnostics.
CREATE OR REPLACE VIEW public.v_trade_channel_attribution_unlinked_details AS
SELECT
  tca.user_id,
  tca.trade_id,
  tca.broker_account_id,
  tca.metaapi_order_id,
  tca.signal_id,
  tca.channel_id,
  tca.channel_label,
  t.symbol,
  t.direction,
  t.status,
  t.profit,
  COALESCE(t.closed_at, t.opened_at, t.created_at) AS trade_time,
  tca.created_at AS attribution_created_at,
  tca.updated_at AS attribution_updated_at
FROM public.trade_channel_attributions tca
LEFT JOIN public.trades t
  ON t.id = tca.trade_id
WHERE
  tca.channel_id IS NULL
  OR lower(trim(coalesce(tca.channel_label, ''))) = 'unlinked / manual';
