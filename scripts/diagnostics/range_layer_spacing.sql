-- Open basket legs where spacing between consecutive entries diverges from configured range_step_pips.
-- Uses broker manual_settings.range_step_pips when available (default 3).

WITH open_legs AS (
  SELECT
    t.user_id,
    t.broker_account_id,
    t.signal_id AS anchor_signal_id,
    t.symbol,
    t.direction,
    t.entry_price,
    t.opened_at,
    ROW_NUMBER() OVER (
      PARTITION BY t.broker_account_id, t.signal_id
      ORDER BY t.opened_at ASC
    ) AS leg_no
  FROM trades t
  WHERE t.status = 'open'
    AND t.broker_account_id IS NOT NULL
    AND t.entry_price IS NOT NULL
    AND t.entry_price > 0
),
paired AS (
  SELECT
    cur.user_id,
    cur.broker_account_id,
    cur.anchor_signal_id,
    cur.symbol,
    cur.direction,
    prev.entry_price AS prev_entry,
    cur.entry_price AS cur_entry,
    ABS(cur.entry_price - prev.entry_price) AS gap_price,
    (ba.manual_settings->>'range_step_pips')::numeric AS configured_step_pips
  FROM open_legs cur
  JOIN open_legs prev
    ON prev.broker_account_id = cur.broker_account_id
    AND prev.anchor_signal_id = cur.anchor_signal_id
    AND prev.leg_no = cur.leg_no - 1
  JOIN broker_accounts ba ON ba.id = cur.broker_account_id
  WHERE (ba.manual_settings->>'range_trading')::boolean IS TRUE
)
SELECT
  user_id,
  broker_account_id,
  anchor_signal_id,
  symbol,
  direction,
  prev_entry,
  cur_entry,
  gap_price,
  COALESCE(configured_step_pips, 3) AS configured_step_pips,
  CASE
    WHEN symbol ILIKE '%XAU%' OR symbol ILIKE '%GOLD%' THEN gap_price / 0.1
    WHEN symbol ILIKE '%JPY%' THEN gap_price / 0.01
    ELSE gap_price / 0.0001
  END AS gap_signal_pips
FROM paired
WHERE ABS(
  CASE
    WHEN symbol ILIKE '%XAU%' OR symbol ILIKE '%GOLD%' THEN gap_price / 0.1
    WHEN symbol ILIKE '%JPY%' THEN gap_price / 0.01
    ELSE gap_price / 0.0001
  END - COALESCE(configured_step_pips, 3)
) > 1.5
ORDER BY cur_entry DESC
LIMIT 200;
