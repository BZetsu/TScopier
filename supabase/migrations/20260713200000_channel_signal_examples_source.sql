-- Distinguish auto-trained vs user-taught examples so retrain keeps manual rows.
ALTER TABLE public.channel_signal_examples
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_signal_examples_source_check'
  ) THEN
    ALTER TABLE public.channel_signal_examples
      ADD CONSTRAINT channel_signal_examples_source_check
      CHECK (source IN ('auto', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS channel_signal_examples_channel_source_sort_idx
  ON public.channel_signal_examples (channel_id, source, sort_order);
