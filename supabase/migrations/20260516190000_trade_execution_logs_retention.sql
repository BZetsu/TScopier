-- Clear accumulated execution logs and retain only the 20 most recent rows per user.

TRUNCATE TABLE public.trade_execution_logs;

CREATE OR REPLACE FUNCTION public.prune_trade_execution_logs(
  p_user_id uuid,
  p_keep integer DEFAULT 20
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_keep < 1 THEN
    p_keep := 20;
  END IF;

  WITH keepers AS (
    SELECT id
    FROM public.trade_execution_logs
    WHERE user_id = p_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT p_keep
  )
  DELETE FROM public.trade_execution_logs t
  WHERE t.user_id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM keepers k WHERE k.id = t.id);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_trade_execution_logs(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_trade_execution_logs(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_prune_trade_execution_logs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.prune_trade_execution_logs(NEW.user_id, 20);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trade_execution_logs_prune ON public.trade_execution_logs;
CREATE TRIGGER trade_execution_logs_prune
  AFTER INSERT ON public.trade_execution_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prune_trade_execution_logs();

COMMENT ON FUNCTION public.prune_trade_execution_logs IS
  'Deletes trade_execution_logs for a user beyond the newest p_keep rows (default 20).';
