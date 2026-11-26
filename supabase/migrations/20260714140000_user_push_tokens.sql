-- Push notification tokens for Expo mobile app
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS user_push_tokens_user_id_idx ON public.user_push_tokens (user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_push_tokens_select_own ON public.user_push_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_push_tokens_insert_own ON public.user_push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_push_tokens_update_own ON public.user_push_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY user_push_tokens_delete_own ON public.user_push_tokens
  FOR DELETE USING (auth.uid() = user_id);
