# Domain cutover checklist — tscopier.ai → unicopier.com

**Date:** 2026-11-05  
**Goal:** Users sign up and receive email as **Unicopier** on **unicopier.com**; Google sign-in shows Unicopier, not TScopier. Target: ready before the weekend, go live ~Monday.  
**Related:** `docs/PROJECT_MEMORY.md` follow-up (domain switch list), `docs/marketing-site.md`, `docs/cloudflare-setup.md` (tscopier.ai Cloudflare layout — mirror this), `docs/signup-spam-protection-setup.md`, `docs/discord-setup.md`.

**DNS:** **Cloudflare** (same account as `tscopier.ai`). Nameservers today for tscopier.ai: `agustin.ns.cloudflare.com` / `stevie.ns.cloudflare.com`.

---

## Decisions (confirm before DNS work)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | App host | `app.unicopier.com` (mirror of `app.tscopier.ai`) |
| D2 | Marketing host | `unicopier.com` + `www.unicopier.com` |
| D3 | Keep old domains? | **Yes** — 301 + keep Supabase/Resend/Stripe working on old hosts during transition so existing links and emails do not break |
| D4 | Email From domain | **unicopier.com** only (stop `.ai` / `.com` split — today fallbacks are mixed) |
| D5 | Old `tscopier.ai` emails | Keep sending from verified old domain until bounce rate on new domain is clean; then flip `RESEND_*_FROM` |

---

## Phase 0 — Inventory (owner: any eng, ~30 min)

- [x] DNS provider: **Cloudflare** (confirmed) — same account/zone style as `docs/cloudflare-setup.md`
- [ ] Where is **unicopier.com** registered? (Hostinger / Netlify / other) — nameservers must point at Cloudflare
- [ ] Resend account access (domains + API key)
- [ ] Google Cloud OAuth client (consent screen + authorized redirects)
- [ ] Cloudflare Turnstile account (same CF account; site keys)
- [ ] Supabase project(s) used in prod (Site URL / Auth)
- [ ] Netlify site(s) that serve app + marketing
- [ ] Discord application OAuth redirects
- [ ] Stripe webhook + customer portal URLs (if host-bound)

---

## Phase 1 — Resend + email sending domain (start first — DNS lead time)

### 1a. Resend dashboard
- [ ] Add domain **unicopier.com** in Resend → Domains
- [ ] Add sending identities (pick one pattern and stick to it):
  - `verification@unicopier.com`
  - `noreply@unicopier.com`
  - `alerts@unicopier.com`
  - (optional) `billing@unicopier.com` if used
- [ ] Copy the DNS records Resend shows (TXT SPF, DKIM CNAME, return-path, etc.)

### 1b. DNS — Cloudflare zone for `unicopier.com`

Add the domain to the **existing Cloudflare account** (same one as `tscopier.ai`), then either assign Cloudflare nameservers at the registrar or confirm the zone is already active.

Proxy conventions (match `docs/cloudflare-setup.md`):

| Record | Name | Target | Proxy |
|--------|------|--------|-------|
| A / CNAME | `@`, `www`, `app` | Netlify site (same IPs/CNAME as tscopier setup) | **Proxied** (orange) |
| CNAME | `sso` | `sxkpcovbyaficvtkpsdo.supabase.co` (if used) | **DNS only** (grey) |
| CNAME | Resend records (per Resend dashboard) | Resend targets | **DNS only** |
| TXT | `resend._domainkey` (if TXT form) | Resend public key | **DNS only** |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:report@unicopier.com` | **DNS only** |
| TXT | `@` SPF | single SPF — **never duplicate** (past PermError on tscopier.ai) | **DNS only** |
| MX | as required for mail (if any) | — | **DNS only** |

- [ ] Create zone `unicopier.com` in Cloudflare → copy nameservers → set at registrar if not already CF
- [ ] Add **all** Resend DNS records (DNS only / grey cloud — email must not go through the proxy)
- [ ] Web hostnames proxied (orange) like tscopier.ai
- [ ] Wait for Resend status **Verified**
- [ ] Verify: `dig @agustin.ns.cloudflare.com <record>.unicopier.com TXT` (or CF’s assigned NS)

### 1c. Code / secrets (after domain verified)
Hardcoded From / fallbacks still on tscopier (grep baseline):

| File | Current From / URL |
|------|--------------------|
| `supabase/functions/send-verification-email/index.ts` | `UniCopier <verification@tscopier.ai>` (hardcoded) |
| `supabase/functions/send-password-reset-email/index.ts` | `UniCopier <verification@tscopier.ai>` (hardcoded) |
| `supabase/functions/alert-evaluator/index.ts` | `TScopier <alerts@tscopier.ai>` (still brand TScopier!) |
| `supabase/functions/signal-review-email/index.ts` | `UniCopier <alerts@tscopier.ai>` |
| `supabase/functions/send-subscription-email/index.ts` | env `RESEND_CAMPAIGN_FROM` or `noreply@tscopier.ai` |
| `supabase/functions/send-subscription-campaigns/index.ts` | env or `noreply@tscopier.com` (**.com split**) |
| `supabase/functions/email-unsubscribe/index.ts` | env or `noreply@tscopier.com` |
| `supabase/functions/manual-broker-override-email/index.ts` | env or `noreply@tscopier.ai` |
| `supabase/functions/send-provider-approval-email/index.ts` | env or `noreply@tscopier.ai` |
| `supabase/functions/_shared/billingPaymentNotification.ts` | env or `noreply@tscopier.ai` |

- [ ] Prefer **env** `RESEND_CAMPAIGN_FROM` / `PROVIDER_EMAIL_FROM` / `ALERT_RESEND_FROM` = new From — set in **Supabase edge secrets** (prod + staging) so no redeploy of every function is required for the address alone
- [ ] Replace remaining **hardcoded** From strings (verification + password-reset) with env + unicopier fallback
- [ ] Fix alert-evaluator brand: `TScopier` → `UniCopier`
- [ ] Unify fallbacks to **one** domain (`noreply@unicopier.com`) — kill `.ai`/`.com` split
- [ ] Deploy changed edge functions (`npm run deploy:function <name>` or dashboard)
- [ ] Send test: verification, password reset, payment failed, provider approval — check From, DKIM, links

### 1d. Email templates / links
- [ ] James: sweep templates for leftover **TScopier** wording (subjects already mostly “UniCopier”)
- [ ] All CTA links use `VITE_APP_URL` / `APP_URL` — must point at new app host after Phase 2
- [ ] Logo assets (`EMAIL_LOGO_URL`, `/unicopier_*.png`) resolve on new host
- [ ] Unsubscribe links work on new host

---

## Phase 2 — Hostnames, Supabase Auth, OAuth

### 2a. DNS (Cloudflare) + Netlify
- [ ] Cloudflare zone `unicopier.com` active (Phase 1b)
- [ ] `unicopier.com` / `www` → Netlify (proxied) — marketing + app dual shell, same as today
- [ ] `app.unicopier.com` → same Netlify site (proxied)
- [ ] Optional: `sso.unicopier.com` → Supabase (`DNS only`, mirror `sso.tscopier.ai`)
- [ ] Netlify domain aliases + HTTPS (Cloudflare SSL mode: match tscopier — Full/Full strict as currently set)
- [ ] Keep `tscopier.ai` + `app.tscopier.ai` live (301 to new hosts only when ready — see Phase 5)

### 2b. Supabase Auth (dashboard)
- [ ] **Site URL** → `https://app.unicopier.com`
- [ ] **Redirect URLs** add:
  - `https://app.unicopier.com/**` (as required today for `app.tscopier.ai`)
  - keep old `https://app.tscopier.ai/...` until cutover complete
- [ ] Google provider: add new redirect origin(s)
- [ ] Confirm email template links / Site URL use new host

### 2c. Google OAuth (“Sign in to TScopier”)
App button copy is already **“Continue with Google”** (`src/i18n/auth/en.ts`) — the **“Sign in to TScopier”** text Martins saw is **Google Cloud consent-screen branding**, not the app.

- [ ] Google Cloud Console → OAuth consent screen → **App name** → **UniCopier**
- [ ] App logo, homepage URL → `https://unicopier.com`
- [ ] Authorized redirect URIs: add Supabase’s Google callback for the new Site URL (Supabase Auth → Providers → Google → redirect URL — copy exactly)
- [ ] Test: signup/login with Google shows **UniCopier**, lands on `app.unicopier.com`

### 2d. Cloudflare Turnstile (same CF account)
- [ ] Turnstile → add hostname `app.unicopier.com` (and `unicopier.com` if widget used on marketing)
- [ ] Reuse existing site key if multi-host allowed; else new widget + Netlify `VITE_TURNSTILE_SITE_KEY`
- [ ] Supabase Auth CAPTCHA secret unchanged if same widget; update if new site key
- [ ] Verify signup/login/forgot-password captcha still appears (fail-closed if missing — see past incident)

### 2e. App host logic (code)
- [ ] `src/lib/site.ts` — defaults + `isAppHost` / `isMarketingHost`:
  - add `app.unicopier.com`, `unicopier.com`, `www.unicopier.com`
  - keep old hosts during transition
- [ ] `src/lib/authPresenceCookie.ts` (or equivalent) — cookie domain: support both `.tscopier.ai` and `.unicopier.com` during dual-run
- [ ] `VITE_APP_URL` + `VITE_MARKETING_URL` on **Netlify** → new origins (baked at build — requires redeploy)
- [ ] Edge fallbacks `https://app.tscopier.ai` → prefer env; update defaults when flipping

### 2f. Other integrations
- [ ] **Discord** OAuth redirects: add `https://app.unicopier.com/...` (`docs/discord-setup.md`)
- [ ] **Stripe**: webhook URL + success/cancel URLs if they embed host; customer portal return URL
- [ ] **Google Analytics** / Search Console: new domain property (optional for Monday)
- [ ] Worker / Railway env: any `VITE_APP_URL`, `WORKER_URL`, public URLs used in emails or Telegram deep links

---

## Phase 3 — Frontend / brand strings

- [ ] Auth pages: Google button already neutral; any **page title / meta** still saying TScopier
- [ ] Signup / onboarding copy: “TScopier” → “Unicopier” (i18n + legal if needed)
- [ ] Email “from” display name: **UniCopier** (already on most subjects)
- [ ] Discord bot / support templates: Unicopier + new invite domain
- [ ] Marketing site: canonical URLs, OG tags, `og:url` → unicopier.com

---

## Phase 4 — Pre-go-live verification (Friday)

- [ ] Fresh signup on `app.unicopier.com` → verification email From `…@unicopier.com`, link opens new host, account activates
- [ ] Password reset end-to-end
- [ ] Google sign-in shows UniCopier, returns to app host
- [ ] Turnstile present on signup
- [ ] Stripe test checkout success URL returns to new app
- [ ] One password-reset + one verification from **staging** first if separate secrets
- [ ] Resend dashboard: delivery, no spam-folder spike, DKIM pass
- [ ] Old host still works (do not break existing users mid-transition)

---

## Phase 5 — Cutover (Monday)

- [ ] Cloudflare: make **unicopier.com** the canonical zone (already active); flip Netlify primary domain
- [ ] Cloudflare **Redirect Rules** (or Netlify redirects):  
  - `tscopier.ai/*` → `https://unicopier.com/$1` (301)  
  - `app.tscopier.ai/*` → `https://app.unicopier.com/$1` (301)  
  Prefer CF Redirect Rules so old hosts keep working even if Netlify primary changes
- [ ] Keep old Supabase redirect URLs until email links age out (typically 30–60 days)
- [ ] Supabase Site URL → new only (after 301s in place)
- [ ] Monitor Resend bounces 48h
- [ ] Support: Notion ticket for any “email link wrong domain” reports

---

## Phase 6 — Notion hygiene (parallel, not launch-blocking)

Already done 2026-11-05:
- [x] Support: FTMO account → **Done**
- [x] Investigate FxSocket connection health → **Done** (platform retired)

Still open (stale since Aug — triage, do not block Monday):
- [ ] In progress ×6 (assistant UX, reported trades page, prompt-injection, 2 bugs, assistant training)
- [ ] Not started: manually reconcile stale trade `1278201` (Critical)
- [ ] Add launch tasks to Notion: Resend domain, Google consent rename, social trading redesign, Discord, template sweep (James)

**Standing rule (Martins):** handle in WhatsApp → **also** flip the Notion status the same day.

---

## Out of scope for Monday (explicit)

- Provider subscription **payments** (UI only until wired)
- Full social trading redesign ship (Martins WIP — ship what’s stable)
- Cerebras top-up / Igor-style copier incidents (separate track)
- FxSocket anything

---

## Quick reference — who does what

| Workstream | Owner |
|------------|--------|
| Cloudflare zone + Resend DNS + Redirect Rules | Eng with CF access |
| Resend domain verify | Eng with Resend access |
| Edge From env + hardcoded From fix | Eng (code) |
| Template wording sweep | James |
| Google consent screen rename | Owner (Google Cloud) |
| Supabase Site/Redirect + Turnstile host | Eng (dashboard) |
| `site.ts` + Netlify env redeploy | Eng |
| Social trading page | Martins |
| Discord redirects | James |
| Notion status discipline | Everyone; James monitors |
