-- Admin action audit trail (immutable)

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  reason text,
  request_payload jsonb,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_created
  ON public.admin_audit_logs(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created
  ON public.admin_audit_logs(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created
  ON public.admin_audit_logs(action, created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- No authenticated client policies: service role / edge functions only.

CREATE OR REPLACE FUNCTION public.prevent_admin_audit_logs_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_logs_no_update ON public.admin_audit_logs;
DROP TRIGGER IF EXISTS admin_audit_logs_no_delete ON public.admin_audit_logs;

CREATE TRIGGER admin_audit_logs_no_update
  BEFORE UPDATE ON public.admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_logs_mutation();

CREATE TRIGGER admin_audit_logs_no_delete
  BEFORE DELETE ON public.admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_logs_mutation();

REVOKE ALL ON FUNCTION public.prevent_admin_audit_logs_mutation() FROM PUBLIC;
