-- Per-user cutover: gramjs listener → Telethon Python listener
-- Run in Supabase SQL Editor AFTER deploying telegram-listener service.
-- Ensure gramjs listener has released the session (stop/restart or wait for lease expiry).

-- UPDATE telegram_sessions
-- SET listener_engine = 'telethon'
-- WHERE user_id = 'YOUR_USER_UUID'::uuid
--   AND is_active = true;

-- Verify:
select user_id, is_active, listener_engine, left(session_string, 20) as session_prefix
from telegram_sessions
where is_active;
