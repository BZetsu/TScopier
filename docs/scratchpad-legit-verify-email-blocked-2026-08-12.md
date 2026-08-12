# Scratchpad — Legit verification emails not sending (2026-08-12)

## Facts
- User signed up as `ivyfiv@gmail.com` at **16:18:38 UTC**, saw "Check your email" + Resend countdown.
- Resend dashboard: no emails newer than ~60min (spam era). No ivyfiv send at signup time.
- `email_verification_sends` for ivy still had `last_sent_at` from **09:25** (old attempt) — signup at 16:18 did **not** claim a send.
- Global bucket `verification_email_global` / `global` had been filled by bot flood ~15:20; 1h window reset ~16:20. Signup at 16:18 was still inside the blocked window.

## Root cause (CONFIDENT)
1. **Emergency global cap of 20/hour** blocked the legit signup while the flood window was still open.
2. **Double-count bug:** edge `enforceGlobalRateLimit` and DB `claim_verification_email_send` both write the same `verification_email_global` bucket → effective ~10 sends/hour.
3. **UX bug:** `SignupPage` treated `rate_limited` / `cooldown` as success and navigated to `/verify-email` with a client countdown → looked like email sent when Resend was never called.

## Fixes applied
- Raised DB `global_max` 20 → **100** (prod + staging migration `20260812220000_*`).
- Reset global abuse row + ivy per-email cooldown.
- Removed edge double global claim; captcha before IP claim; SignupPage shows real error.
- Manually set `user_profiles.email_verified_at` for ivy so they can log in (email never delivered due to our cap).

## Ops
- Redeploy `send-verification-email` edge (remove double global) — required so edge max is not stuck at 20.
- Frontend deploy for SignupPage UX fix.
- Turnstile secret + Netlify site key still required for captcha path.
