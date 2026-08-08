-- Admin SQL: identify the actual execution type of every persisted trade.
--
-- Run Query 1 first. It is the preflight for the broker-ticket uniqueness
-- migration. Query 2 is read-only and returns the evidence used to classify
-- each trade. It deliberately returns "unknown" when the persisted evidence
-- is insufficient; broker-account configuration alone is not treated as proof
-- of the actual execution type.

-- 1) Database guard preflight: duplicate broker tickets.
SELECT
  broker_account_id,
  metaapi_order_id,
  count(*) AS trade_rows,
  array_agg(id ORDER BY created_at) AS trade_ids,
  array_agg(signal_id ORDER BY created_at) AS signal_ids,
  min(created_at) AS first_persisted_at,
  max(created_at) AS last_persisted_at
FROM public.trades
WHERE broker_account_id IS NOT NULL
  AND metaapi_order_id IS NOT NULL
GROUP BY broker_account_id, metaapi_order_id
HAVING count(*) > 1
ORDER BY trade_rows DESC, first_persisted_at;

-- 2) Actual trade-type classification with evidence.
WITH successful_order_logs AS (
  SELECT DISTINCT ON (l.signal_id, l.broker_account_id, l.response_payload->>'ticket')
    l.signal_id,
    l.broker_account_id,
    l.response_payload->>'ticket' AS broker_ticket,
    NULLIF(l.request_payload->>'comment', '') AS order_comment,
    l.request_payload->>'operation' AS broker_operation,
    l.request_payload->>'symbol' AS requested_symbol,
    l.response_payload->>'leg' AS leg_number,
    l.response_payload->>'total' AS planned_leg_total,
    l.created_at AS order_send_logged_at
  FROM public.trade_execution_logs AS l
  WHERE l.action = 'order_send'
    AND l.status = 'success'
    AND l.response_payload->>'ticket' IS NOT NULL
  ORDER BY l.signal_id, l.broker_account_id, l.response_payload->>'ticket', l.created_at DESC
),
trade_family_stats AS (
  SELECT
    t.signal_id,
    t.broker_account_id,
    count(*) AS signal_broker_trade_count,
    count(DISTINCT concat_ws('|', t.symbol, t.direction, t.lot_size::text, t.sl::text, t.tp::text)) AS signal_broker_signature_count
  FROM public.trades AS t
  GROUP BY t.signal_id, t.broker_account_id
),
trade_families AS (
  SELECT
    t.*,
    s.signal_broker_trade_count,
    s.signal_broker_signature_count
  FROM public.trades AS t
  LEFT JOIN trade_family_stats AS s
    ON s.signal_id = t.signal_id
   AND s.broker_account_id = t.broker_account_id
),
evidence AS (
  SELECT
    t.id AS trade_id,
    t.user_id,
    t.signal_id,
    t.broker_account_id,
    t.metaapi_order_id,
    t.symbol,
    t.direction,
    t.lot_size,
    t.entry_price,
    t.sl,
    t.tp,
    t.status,
    t.opened_at,
    t.closed_at,
    t.profit,
    t.signal_broker_trade_count,
    t.signal_broker_signature_count,
    l.order_comment,
    l.broker_operation,
    l.requested_symbol,
    l.leg_number,
    l.planned_leg_total,
    l.order_send_logged_at,
    b.label AS broker_label,
    b.manual_settings->>'trade_style' AS configured_trade_style,
    b.manual_settings->>'range_trading' AS configured_range_trading,
    b.manual_settings->>'layering_mode' AS configured_layering_mode,
    b.manual_settings->>'range_layering_type' AS configured_range_layering_type
  FROM trade_families AS t
  LEFT JOIN successful_order_logs AS l
    ON l.signal_id = t.signal_id
   AND l.broker_account_id = t.broker_account_id
   AND l.broker_ticket = t.metaapi_order_id
  LEFT JOIN public.broker_accounts AS b
    ON b.id = t.broker_account_id
)
SELECT
  e.*,
  CASE
    WHEN lower(coalesce(e.order_comment, '')) ~ '(^|:)rg[0-9]+'
      AND lower(coalesce(e.order_comment, '')) ~ '(^|:)tp'
      THEN 'range_layered'
    WHEN lower(coalesce(e.order_comment, '')) ~ '(^|:)rg[0-9]+'
      OR lower(coalesce(e.order_comment, '')) ~ '(^|:)rg'
      THEN 'range'
    WHEN lower(coalesce(e.order_comment, '')) ~ '(^|:)tp[0-9]+'
      OR lower(coalesce(e.order_comment, '')) ~ '(^|:)tp\.rem'
      OR lower(coalesce(e.order_comment, '')) ~ '(^|:)layer_'
      OR lower(coalesce(e.order_comment, '')) LIKE 'layer_%'
      THEN 'layered'
    WHEN e.signal_broker_trade_count > 1
      AND e.signal_broker_signature_count = 1
      AND e.order_comment IS NOT NULL
      THEN 'duplicate_replay_candidate'
    WHEN e.signal_broker_trade_count = 1
      AND e.order_comment IS NOT NULL
      THEN 'single'
    WHEN e.signal_broker_trade_count > 1
      THEN 'multi_unclassified'
    ELSE 'unknown'
  END AS actual_trade_type,
  CASE
    WHEN e.order_comment IS NULL THEN 'No successful order_send comment was persisted; do not infer from account settings.'
    WHEN lower(e.order_comment) ~ '(^|:)rg' THEN 'Order comment contains the range-leg marker :rg.'
    WHEN lower(e.order_comment) ~ '(^|:)tp|(^|:)layer_' THEN 'Order comment contains a planner/layer marker.'
    WHEN e.signal_broker_trade_count > 1 AND e.signal_broker_signature_count = 1
      THEN 'Multiple same-signal/same-broker rows share the same trade signature.'
    WHEN e.signal_broker_trade_count = 1
      THEN 'One persisted trade for this signal and broker; no range/layer marker found.'
    ELSE 'Multiple trades exist, but persisted evidence does not identify the execution subtype.'
  END AS classification_reason
FROM evidence AS e
ORDER BY e.opened_at DESC NULLS LAST;
