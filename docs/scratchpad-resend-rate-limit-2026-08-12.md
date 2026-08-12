# Scratchpad — Resend rate limit / cooldown not stopping spam signup emails

**Date:** 2026-08-12  
**Report:** Resend shows many "Confirm your TScopier account" emails to `gaylord*@pornhub.com` within ~1–2 minutes. User suspects Resend rate limit / cooldown is not working.

## Facts
- Screenshot: delivered/bounced confirms to gaylord#####@pornhub.com, subjects "Confirm your TScopier account", clustered ~15–16 min before screenshot (~16:09 local).
- We later blocked pornhub domains + keywords and deleted those auth users.
- Bots then pivoted to mamadou#####@hotmail.com (also auto-confirmed / email sent).

## Questions
1. When is the confirmation email sent relative to `auth.users` INSERT / spam trigger?
2. Does `claim_auth_abuse_slot` run on every signup verification send?
3. What are the configured caps (per IP / per email)?
4. Are bots using many IPs so per-IP limits never trip?
5. Is cooldown only for *resend*, not first signup send?

## Hypotheses
- H1: First signup send bypasses abuse slot / cooldown (cooldown only on resend).
- H2: Rate limit is per hashed IP; distributed bots never hit cap.
- H3: Emails were sent before domain keyword block; rate limit still too weak for burst.
- H4: Custom `send-verification-email` not used — Supabase built-in Auth email fires instead.
- H5: `claim_auth_abuse_slot` errors / not deployed / not called.

## Evidence log

### 2026-08-12 diagnosis (CONFIDENT)

1. **Per-email cooldown works, but is useless against bots.**  
   `claim_verification_email_send` keys on email. Every `gaylord######@pornhub.com` / `mamadou######` / `*@example.net` is a new address → `window_send_count=1` each. Cooldown never trips across a burst.

2. **Per-IP limit exists but is too weak / incomplete.**  
   `AUTH_EMAIL_MAX_PER_HOUR_IP = 10`. Prod has only **8** `auth_abuse_rate_limits` rows vs **41** verification sends in the last hour → few IPs each allowed up to 10 sends. That alone explains dozens of Resend emails.

3. **Missing IP skips the limit entirely.**  
   `enforceIpRateLimit`: `if (!ip) return null` → allow. Any request without `cf-connecting-ip` / `x-forwarded-for` bypasses IP capping.

4. **No global Resend send cap.**  
   Nothing stops “N unique emails × M IPs” from hitting Resend until Resend’s own 10 req/s API limit.

5. **Domain blocks lag the bot.**  
   Screenshot emails are the earlier gaylord@pornhub wave (before domain keyword block). New wave now: `*@example.com` / `*@example.net` (not yet blocked) + `a_wagn2er@hotmail.com`.

6. **Turnstile is a no-op without secret.**  
   `verifyTurnstileToken` returns `true` if `TURNSTILE_SECRET_KEY` unset.

### Root cause (plain English)
Cooldown = “same email can’t get another email for 60s”. Bots use a **new** email every time, so cooldown never applies. IP limit allows **10 emails per IP per hour**, and there is **no total cap** on how many confirmation emails we send. So Resend keeps getting one email per bot signup.

### Fix applied (2026-08-12)

1. **DB (live):** `claim_verification_email_send` now enforces global **20 verification emails/hour** via `claim_auth_abuse_slot('verification_email_global','global',20)`. Verified claim returns `rate_limited` when saturated.
2. Emergency saturated global bucket to 20 to stop ongoing Resend flood.
3. Blocked `example.com/.net/.org` in signup trigger + policies.
4. Edge code updated (IP 3/hour, missing-IP capped, global enforce) — deploy pending (CLI Forbidden); DB path already protects Resend.
5. Deleted spam account bursts (example/outlook/proton waves).

### Counterargument check
- "Maybe Resend itself should rate limit us?" Resend allows 10 req/s — far above our burst of ~1 email/2s. App must self-throttle.
- "Maybe cooldown is broken?" Evidence shows `window_send_count=1` per unique spam address — cooldown works as designed, wrong design for this attack.
