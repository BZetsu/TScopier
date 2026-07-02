-- ForexBro Elite Signals: registry row, keyword cleanup, link subscribers.

INSERT INTO public.signal_channels (telegram_chat_id, channel_username, display_name, first_seen_at)
VALUES ('-1003712194296', '', 'ForexBro Elite Signals', now())
ON CONFLICT (telegram_chat_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    updated_at = now();

UPDATE public.telegram_channels tc
SET
  signal_channel_id = sc.id,
  channel_keywords = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(tc.channel_keywords, '{}'::jsonb),
        '{update,set_sl}',
        '""'::jsonb
      ),
      '{update,adjust_sl}',
      '""'::jsonb
    ),
    '{additional,ai_management_keyword_groups,modify_sl}',
    '[]'::jsonb
  ),
  updated_at = now()
FROM public.signal_channels sc
WHERE sc.telegram_chat_id = '-1003712194296'
  AND tc.channel_id = '-1003712194296';
