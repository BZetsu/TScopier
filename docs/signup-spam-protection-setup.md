# Signup Spam Protection — Dashboard Setup

Complete these steps **in the same deploy window** as the frontend Turnstile release. Enabling CAPTCHA in Supabase before the frontend ships will block all email signups.

## 1. Cloudflare Turnstile

Widget already created. Keys:

| Variable | Where | Value |
|----------|-------|-------|
| `VITE_TURNSTILE_SITE_KEY` | Netlify (prod + staging) + local `.env` | `0x4AAAAAAENwYkTwFMwfAUdc` |
| Turnstile secret | Supabase Dashboard → Auth → CAPTCHA **and** `supabase secrets set TURNSTILE_SECRET_KEY=...` | From Cloudflare Turnstile widget |

1. Confirm widget hostnames include `app.tscopier.ai`, `staging.tscopier.ai`, and `localhost`
2. Set Netlify env `VITE_TURNSTILE_SITE_KEY=0x4AAAAAAENwYkTwFMwfAUdc` and redeploy frontend
3. Set Supabase secret (staging + prod):
   ```bash
   supabase secrets set TURNSTILE_SECRET_KEY=<turnstile-secret> --project-ref axdcledcyhyvzrnfkwat
   supabase secrets set TURNSTILE_SECRET_KEY=<turnstile-secret> --project-ref sxkpcovbyaficvtkpsdo
   ```

## 2. Supabase Auth CAPTCHA

1. [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Bot and Abuse Protection**
2. Enable **CAPTCHA protection**
3. Provider: **Cloudflare Turnstile**
4. Secret key: same Turnstile secret as above

## 3. Supabase Auth Rate Limits

1. **Authentication** → **Rate Limits**
2. Enable **IP Address Forwarding**
3. Lower **Rate limit for sign-ups and sign-ins** (e.g. 5 per 5 minutes per IP)

Apply on **both** staging (`axdcledcyhyvzrnfkwat`) and production (`sxkpcovbyaficvtkpsdo`).

## 4. Auth Hook (before-user-created)

1. **Authentication** → **Auth Hooks** → **before-user-created**
2. Type: **HTTP Endpoint**
3. URL: `https://<project-ref>.supabase.co/functions/v1/auth-before-user-created`
4. Generate hook secret → set as Supabase secret:
   ```bash
   supabase secrets set BEFORE_USER_CREATED_HOOK_SECRET="v1,whsec_<base64>"
   ```
5. Deploy edge function: `supabase functions deploy auth-before-user-created --use-api`

## 5. Deploy checklist

- [ ] Migration `20260812140000_auth_abuse_rate_limits.sql` applied (staging + prod)
- [ ] Edge functions deployed: `send-verification-email`, `send-password-reset-email`, `auth-before-user-created`, `admin-query`, `admin-mutate`
- [ ] `TURNSTILE_SECRET_KEY` + `BEFORE_USER_CREATED_HOOK_SECRET` set on Supabase
- [ ] `VITE_TURNSTILE_SITE_KEY` set on Netlify (redeploy frontend)
- [ ] Supabase CAPTCHA enabled **after** frontend deploy is live
- [ ] Auth hook enabled pointing at `auth-before-user-created`

## 6. Cleanup existing spam (optional)

Backoffice **Overview** → **Ban spam signups** button, or SQL (destructive):

```sql
-- Preview only — run SELECT first
SELECT id, email, created_at FROM auth.users
WHERE email ILIKE 'pornhub%@hotmail.com'
ORDER BY created_at DESC;
```

Use backoffice bulk ban action instead of raw DELETE unless you need full removal.
