# Scratchpad — Turnstile bypass on production

**Date:** 2026-08-12  
**Report:** Bots keep signing up; user suspects Cloudflare Turnstile is not working on production.

## Questions
1. Is Turnstile widget rendered on production signup?
2. Is `VITE_TURNSTILE_SITE_KEY` set on Netlify prod?
3. Is `TURNSTILE_SECRET_KEY` set on Supabase prod secrets?
4. Does server verify fail-open when secret missing?
5. Can bots call `auth.signUp` / edge functions without a token?
6. Is Supabase Auth CAPTCHA enabled in dashboard (separate from our edge check)?

## Hypotheses
- H1: `verifyTurnstileToken` returns `true` when `TURNSTILE_SECRET_KEY` unset (fail-open).
- H2: Signup calls `auth.signUp` before/without requiring captcha for account creation; only email send checks captcha, and even that is fail-open or skipped when session exists.
- H3: Site key missing → widget hidden → empty token accepted somehow.
- H4: Supabase Auth CAPTCHA not enabled → `signUp` never needs captcha.

## Evidence

1. **CONFIDENT — Prod frontend has no Turnstile.** Curl of `app.tscopier.ai` main JS found **0** matches for `turnstile` / `0x4AAAA` / `marsidev`. Empty `VITE_TURNSTILE_SITE_KEY` at Netlify build → `isTurnstileEnabled() === false` → widget returns `null` → signup does not require captcha.
2. **CONFIDENT — Server fail-open.** `verifyTurnstileToken`: `if (!secret) return true`.
3. **CONFIDENT — Authed path skipped captcha** on `send-verification-email`.
4. **CONFIDENT — Auth CAPTCHA checklist still unchecked** in `docs/signup-spam-protection-setup.md`. Without dashboard CAPTCHA, `signUp({ captchaToken })` is not enforced server-side; bots hit Supabase Auth API directly.
5. **CONFIDENT — `auth-before-user-created` does not check Turnstile** (email policy only) and hook may not be enabled.

## Root cause (plain English)
Turnstile was coded but never fully turned on for production. Missing Netlify site key means no widget. Missing/unenforced secret means the server does not reject missing tokens. Auth API signups do not require captcha until the Supabase dashboard toggle is on.

## Fixes
- Code: fail-closed secret, always verify on verification email, prod misconfig guard on auth pages.
- Ops (must do): Netlify env + redeploy, Supabase secret, Auth CAPTCHA enable, Auth Hook enable.
