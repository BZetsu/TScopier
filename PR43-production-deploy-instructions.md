# Production Deploy - PR #43

## Step 1: Merge PR #43

1. Go to https://github.com/tartarixinc/TScopier/pull/43
2. Review the 3 commits listed below
3. Click the green "Merge pull request" button
4. Click "Confirm merge"

**Commits included:**

- Persist MTProto session during `send_code` so `verify_code` works across replica restarts
- Fix GramJS `_updateLoop` TIMEOUT death spiral during auth; reconnect disconnected client before `tgInvoke`
- `clientErrorPayload()` for stable error responses + migration to enable realtime on `telegram_auth_pending`

## Step 2: Run migration on production

**Option A - Supabase Dashboard:**

1. Open https://supabase.com/dashboard/project/sxkpcovbyaficvtkpsdo/sql/new
2. Paste this SQL:

```sql
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
```

3. Click "Run"

**Option B - CLI:**

```bash
supabase db push --project-ref sxkpcovbyaficvtkpsdo
```

## Done

Railway auto-deploys from main after the merge.
