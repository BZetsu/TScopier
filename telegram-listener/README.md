# Telethon listener (Python)

Replaces the gramjs `UserListener` for users with `telegram_sessions.listener_engine = 'telethon'`.

## Deploy (Railway)

- **Root directory:** `telegram-listener`
- **Replicas:** 1 per shard (never scale horizontally — one MTProto session per user)
- **Env:** same as TS listener plus:

```env
WORKER_ROLE=listener
LISTENER_ENGINE=telethon
TRADE_WORKER_URL=https://your-trade-worker.up.railway.app
WORKER_INTERNAL_TOKEN=<shared with trade>
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
```

Point Supabase Edge `TELEGRAM_LISTENER_URL` (or `WORKER_URL`) at this service for auth.

## Cutover

1. Deploy this service
2. `UPDATE telegram_sessions SET listener_engine = 'telethon' WHERE user_id = '...'`
3. Restart gramjs listener shard (user dropped) and verify Telethon picks up session
4. Post test signal — expect Copier Logs row within 30s (poll backstop)

## Local

```bash
cd telegram-listener
pip install -r requirements.txt
export $(grep -v '^#' ../worker/.env | xargs)  # or set vars manually
uvicorn app.main:app --reload --port 8080
```
