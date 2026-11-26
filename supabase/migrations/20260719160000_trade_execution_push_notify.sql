/*
  # Push trade alerts via Expo

  After a successful trade_execution_log insert for notification-worthy actions,
  call send-push-notification so registered mobile devices receive an Expo push.
*/

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_trade_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_symbol text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'success' THEN
    RETURN NEW;
  END IF;

  IF NEW.action NOT IN (
    'order_send',
    'signal_entry_pending_filled',
    'virtual_pending_fired',
    'merge_modify_summary',
    'mgmt_modify',
    'mgmt_breakeven',
    'mgmt_partial_breakeven',
    'merge_routed_modify_only',
    'signal_merge_into_open_trade',
    'basket_leg_modify',
    'mgmt_close',
    'mgmt_close_worse_entries',
    'cwe_close',
    'opposite_signal_close',
    'partial_tp_fired'
  ) THEN
    RETURN NEW;
  END IF;

  IF v_url IS NULL OR v_key IS NULL OR length(trim(v_url)) = 0 OR length(trim(v_key)) = 0 THEN
    RAISE NOTICE 'Skipping trade push: missing app.settings.supabase_url or service_role_key';
    RETURN NEW;
  END IF;

  -- Prefer symbol from request/response payload when present.
  v_symbol := COALESCE(
    NEW.request_payload ->> 'symbol',
    NEW.response_payload ->> 'symbol',
    NEW.request_payload #>> '{parsed,symbol}',
    NEW.response_payload #>> '{symbol}'
  );

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'action', NEW.action,
      'status', NEW.status,
      'symbol', v_symbol,
      'href', '/(app)/alerts'
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trade_execution_logs_push_notify ON public.trade_execution_logs;

CREATE TRIGGER trade_execution_logs_push_notify
  AFTER INSERT ON public.trade_execution_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_trade_push();

COMMENT ON FUNCTION public.notify_trade_push IS
  'Queues Expo push via send-push-notification for successful, notification-worthy trade logs.';
