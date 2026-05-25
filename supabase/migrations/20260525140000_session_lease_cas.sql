-- Atomic session lease acquire (prevents two listeners racing the same user).

CREATE OR REPLACE FUNCTION acquire_worker_session_lease(
  p_user_id uuid,
  p_worker_id text,
  p_role text,
  p_shard_id integer,
  p_shard_count integer,
  p_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  UPDATE worker_session_leases
  SET
    worker_id = p_worker_id,
    role = p_role,
    shard_id = p_shard_id,
    shard_count = p_shard_count,
    expires_at = p_expires_at,
    updated_at = now()
  WHERE user_id = p_user_id
    AND (worker_id = p_worker_id OR expires_at <= now());

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN true;
  END IF;

  BEGIN
    INSERT INTO worker_session_leases (
      user_id, worker_id, role, shard_id, shard_count, expires_at, updated_at
    ) VALUES (
      p_user_id, p_worker_id, p_role, p_shard_id, p_shard_count, p_expires_at, now()
    );
    RETURN true;
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;
END;
$$;

REVOKE ALL ON FUNCTION acquire_worker_session_lease FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_worker_session_lease TO service_role;
