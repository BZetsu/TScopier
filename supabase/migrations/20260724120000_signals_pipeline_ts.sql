ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS pipeline_ts jsonb;
