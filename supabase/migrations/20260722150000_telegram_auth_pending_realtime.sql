-- Listener workers subscribe to telegram_auth_pending so auth starts can pause
-- any live MTProto session before a phone/QR login opens a fresh client.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'telegram_auth_pending'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_auth_pending';
  END IF;
END $$;
