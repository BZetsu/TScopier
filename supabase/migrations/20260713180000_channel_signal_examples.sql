-- Few-shot labeled examples per channel for universal AI signal parsing.
CREATE TABLE IF NOT EXISTS public.channel_signal_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.telegram_channels(id) ON DELETE CASCADE,
  raw_message text NOT NULL,
  raw_message_hash text NOT NULL,
  label text NOT NULL CHECK (label IN ('entry', 'update', 'ignore')),
  intent jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_signal_examples_channel_hash_unique UNIQUE (channel_id, raw_message_hash)
);

CREATE INDEX IF NOT EXISTS channel_signal_examples_channel_sort_idx
  ON public.channel_signal_examples (channel_id, sort_order);

ALTER TABLE public.channel_signal_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_signal_examples_select_own ON public.channel_signal_examples
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY channel_signal_examples_insert_own ON public.channel_signal_examples
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY channel_signal_examples_update_own ON public.channel_signal_examples
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY channel_signal_examples_delete_own ON public.channel_signal_examples
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY channel_signal_examples_service_role ON public.channel_signal_examples
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
