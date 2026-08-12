# Scratchpad — Signup protection misconfigured (2026-08-12)

## Facts
- Live `https://app.tscopier.ai/signup` shows: "Signup protection is misconfigured. Please try again later."
- Message comes from `isTurnstileMisconfigured()` when `import.meta.env.PROD && !VITE_TURNSTILE_SITE_KEY`.

## Root cause (CONFIDENT)
Netlify production build shipped the Turnstile fail-closed UI **without** baking `VITE_TURNSTILE_SITE_KEY`. Widget never enables; form blocks submit.

## Fix
1. **Ops (unblocks prod immediately):** Netlify → Environment variables → `VITE_TURNSTILE_SITE_KEY=0x4AAAAAAENwYkTwFMwfAUdc` → Trigger deploy → **Clear cache and deploy site**.
2. **Also required:** `supabase secrets set TURNSTILE_SECRET_KEY=...` on prod (edge verify is fail-closed).
3. **Code:** `netlify.toml` `[build.environment]` + `turnstile.ts` fallback so missing UI env cannot recur.

## Status
- Code changes local on `off-staging-free-trial`.
- Prod still broken until Netlify redeploy with site key (env and/or netlify.toml merge).
