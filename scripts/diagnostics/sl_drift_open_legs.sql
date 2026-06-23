-- Open legs whose DB stoploss differs from channel_active_trade_params (SL drift).
-- Also lists failed basket reconcile jobs for the same baskets.

SELECT
  t.user_id,
  t.broker_account_id,
  t.signal_id AS anchor_signal_id,
  t.symbol,
  t.sl AS trade_sl,
  catp.stoploss AS channel_sl,
  t.opened_at,
  ABS(COALESCE(t.sl, 0) - COALESCE(catp.stoploss, 0)) AS sl_delta
FROM trades t
JOIN telegram_channels tc ON tc.id = t.telegram_channel_id
LEFT JOIN channel_active_trade_params catp
  ON catp.user_id = t.user_id
  AND catp.channel_id = t.telegram_channel_id
  AND catp.symbol = t.symbol
WHERE t.status = 'open'
  AND catp.stoploss IS NOT NULL
  AND catp.stoploss > 0
  AND (
    t.sl IS NULL
    OR ABS(t.sl - catp.stoploss) > 0.00001
  )
ORDER BY t.opened_at DESC
LIMIT 200;

-- Failed reconcile jobs (mgmt SL/TP not fully applied)
SELECT
  j.user_id,
  j.broker_account_id,
  j.anchor_signal_id,
  j.symbol,
  j.status,
  j.attempts,
  j.max_attempts,
  j.last_error,
  j.next_run_at,
  j.updated_at
FROM basket_reconcile_jobs j
WHERE j.status IN ('pending', 'failed')
ORDER BY j.updated_at DESC
LIMIT 100;
