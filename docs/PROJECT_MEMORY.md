# Project Memory

## Changelog

### 2026-07-23 — Fixed Telegram "Login session expired" on verify_code after worker restart

- **Context:** Telegram auth flow failed with "Login session expired" after entering verification code. Root cause: when the Railway worker restarts between `send_code` and `verify_code`, the in-memory MTProto session is lost. DB recovery built a fresh client, but Telegram's `auth.signIn` rejected the old `phoneCodeHash` because `auth.sendCode` was never called on that fresh connection ("No pending auth flow").
- **Fix:** Save the MTProto `StringSession` during `sendCode` and persist it to `telegram_auth_pending.auth_session_string`. `restorePhonePendingFromDatabase` already uses `buildClient(savedSession)` — now `savedSession` contains the actual session for non-2FA cases too, enabling cross-replica/restart recovery of the `sendCode → signIn` binding.
- **Files:** `worker/src/authService.ts`
- **Follow-up:** User should retry Telegram auth flow on staging. If it still fails, check Railway logs for MTProto errors.

### 2026-07-22 — Full staging environment setup: Cloudflare DNS, Netlify staging site, Railway listener, Supabase edge functions, Telegram auth

- **Context:** Massive session. Set up complete staging environment infrastructure end-to-end. Started with domain DNS management (Cloudflare), then Netlify staging site (cross-team workaround), Railway listener worker, Supabase edge functions with Telegram auth.
- **Change:**
  - **Cloudflare:** Added tscopier.ai to Cloudflare, imported all 34 DNS records (A, CNAME, MX, TXT, DKIM). Identified and added missing records (sso CNAME, Stripe billing records, _acme-challenge.sso TXT). Set proxy status (hostingermail DKIM → DNS only, staging CNAME → DNS only). Created `docs/cloudflare-setup.md`. Domain registered through Netlify (reseller for Name.com) — nameserver change requires Netlify support ticket.
  - **Git workflow:** CTO changed flow to: individual branches → dev (integration) → staging (admin approval) → main (production). Updated AGENTS.md and docs/staging-environment.md. Removed PR references (direct push now). Hotfix cherry-picks to dev only.
  - **Netlify staging:** Created new staging site under Tartarix team (`legendary-valkyrie-4da363.netlify.app`), deployed from BZetsu/TScopier:staging. Set env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_URL, VITE_MARKETING_URL). staging.tscopier.ai CNAME exists in DNS but domain can't be connected (cross-team restriction — domain belongs to Tartarix team, not user's team).
  - **Code fix:** Modified `src/lib/site.ts` — added `staging.tscopier.ai` and `legendary-valkyrie-4da363.netlify.app` to `isAppHost()` so staging site renders the app (not marketing) and links stay on staging domain.
  - **Supabase staging:** Staging Supabase project linked (`jolsabyxmjuhohozwdrc`). telegram-auth edge function deployed. Secrets set: WORKER_INTERNAL_TOKEN (be6161793...), WORKER_URL (https://tscopier-worker-staging.up.railway.app).
  - **Railway listener:** Listener worker running at `tscopier-worker-staging.up.railway.app`, role listener, shard 0/1. Health check passing (`{"ok":true}`). Connected to staging Supabase.
  - **Telegram credentials:** User created own Telegram API app (ID: 30670916, Hash: 469129b31e84d3b21d319d18abebf9d7).
  - **Docs created/updated:** PROJECT_MEMORY.md, AGENTS.md, docs/staging-environment.md, docs/cloudflare-setup.md.
- **Files:** `src/lib/site.ts`, `AGENTS.md`, `docs/staging-environment.md`, `docs/cloudflare-setup.md`, `docs/PROJECT_MEMORY.md`, `.env`
- **Active state:**
  - ✅ Cloudflare nameservers live (`agustin.ns.cloudflare.com`, `stevie.ns.cloudflare.com`)
  - ✅ staging.tscopier.ai resolves to `vermillion-cannoli-69a895.netlify.app` (Tartarix team Netlify site)
  - ✅ Staging site serves the app (code fix verified: `staging.tscopier.ai` in `isAppHost()`)
  - ✅ Railway listener running (role listener, shard 0/1, health OK)
  - ✅ telegram-auth edge function deployed, WORKER_URL + WORKER_INTERNAL_TOKEN set as Supabase secrets
  - ❌ Trade worker not set up (needs FXSOCKET_API_KEY)
  - ❌ Backtest worker not set up
- **New staging site URL:** `https://staging.tscopier.ai/` (also: `https://vermillion-cannoli-69a895.netlify.app/`)
- **Railway listener:** `https://tscopier-worker-staging.up.railway.app`
- **Next steps:** 1) Test Telegram auth flow. 2) Set up trade worker + FxSocket key. 3) Set up backtest worker.

### 2026-07-22 — Updated git workflow: feature branches off dev, annotated step-by-step docs

- **Context:** CTO changed deployment flow to: individual branches → `dev` (integration) → `staging` (admin approval) → `main` (production). Documented every command with full comments explaining what each does and why.
- **Change:**
  - Updated `AGENTS.md` git workflow: feature branches off `dev`, admin promotes `dev → staging` and `staging → main`, hotfix cherry-picks to `dev` only
  - Rewrote `docs/staging-environment.md`: branch diagram now shows `feature/* → dev → staging → main`, dev is "integration branch" not "personal branch", full annotated step-by-step (Step 1-7) with explanation for each git command, admin-only promotion sections, cleanup instructions
  - Updated daily sync to pull `dev` instead of `main`
  - Updated feature branch workflow to branch from `upstream/dev` not `main`
  - Changed hotfix flow to cherry-pick into `dev` only (not staging)
  - Removed PR references — we direct push now
- **Files:** `AGENTS.md`, `docs/staging-environment.md`
- **Follow-up:** None

### 2026-07-22 — Set up dev + staging branches on production repo, full pipeline documented

- **Context:** User clarified their workflow: work on fork → push to dev branch on production → staging → main. Railway auto-deploys from main/staging, so dev branch must be safe. Also added "never delete" rule after incident.
- **Change:**
  - Created `dev` branch (from main) on tartarixinc/TScopier — no auto-deploys
  - Created `staging` branch (from main) on tartarixinc/TScopier — triggers staging Railway
  - Updated `AGENTS.md` with full git workflow (fork → dev → staging → main), remotes, and branch purposes
  - Updated `docs/staging-environment.md` with dev branch in pipeline, updated hotfix flow
  - Added "NEVER delete anything without permission" rule to AGENTS.md Safety & Preservation section
- **Files:** `AGENTS.md`, `docs/staging-environment.md`
- **Follow-up:** Link the Supabase staging project to the local repo

### 2026-07-22 — Documented three branches + step-by-step promotion commands

- **Context:** User needed a simpler explanation of upstream/dev/staging/main and exact commands to push from fork → dev → staging → main.
- **Change:** Added to `docs/staging-environment.md`:
  - "Three branches on production" section with plain explanation + analogy (desk / testing room / live stage)
  - "Step-by-step: moving code through pipeline" with exact commands for each hop
  - Which repo to use (fork vs production clone) and when
  - Full workflow at the bottom with all 4 commands
- **Files:** `docs/staging-environment.md`

### 2026-07-22 — Documented full git workflow with sync, rebase, and hotfix

- **Context:** User asked how to pull production code, avoid merge conflicts, and the correct workflow from fork → dev → staging → main.
- **Change:** Added "Git sync & workflow" section to `docs/staging-environment.md` covering: daily sync before work, feature branch creation, rebase on upstream/dev before PR, why rebase vs merge, small PRs, hotfix with cherry-pick, and pulling mid-work.
- **Files:** `docs/staging-environment.md`

### 2026-07-22 — Documented Railway architecture for CEO provisioning

- **Context:** User needed to understand the 3 Railway services (Listener, Worker, Backtest) so they could ask the CEO to create a staging Railway project. User got "not authorized" trying to create one.
- **Change:** Created `docs/railway-architecture.md` explaining each service's purpose (Listener = Telegram connection + signal parse, Worker = MT4/5 execution via FxSocket, Backtest = historical simulation), data flow, constraints (1 replica per listener shard), and what the CEO needs to create for staging.
- **Files:** `docs/railway-architecture.md`
- **Follow-up:** User needs to send the Railway setup request to the CEO.

### 2026-07-22 — Added staging deployment pipeline documentation

- **Context:** User needed a clear plan for safely promoting changes from staging to production, including infrastructure setup, branch strategy, and rollback procedures.
- **Change:**
  - Created `docs/staging-environment.md` with full staging setup guide: branch strategy, infra table per service, env vars per service, deployment pipeline for each service (Netlify, Railway, Supabase), promotion checklist, rollback procedures, and hotfix flow
  - Database migration safety rules documented: additive-only preference, two-phase destructive changes, backward-compatible schema, idempotent migrations
  - Key design decision: separate Supabase project for staging = strongest isolation guarantee (staging worker physically cannot touch prod data)
- **Files:** `docs/staging-environment.md`
- **Follow-up:** User needs to provision staging infra (Supabase project, Railway project, Netlify site, Stripe test keys) before staging can be used.

### 2026-07-22 — Setup: staging environment from production fork

- **Context:** Forked the production TScopier repo into `~/projects/TSCopier` to create a staging environment. No production infra credentials or secrets were copied.
- **Change:**
  - Cloned `https://github.com/BZetsu/TScopier.git` into `/home/jbzetsu/projects/TSCopier`
  - Created `AGENTS.md` — comprehensive agent guide with project commands, architecture, constraints, testing quirks, agent behavior rules, and reasoning rules
  - Created `docs/PROJECT_MEMORY.md` — this file, for tracking all code changes across sessions
- **Files:** `AGENTS.md`, `docs/PROJECT_MEMORY.md`
- **Follow-up:** Awaiting user instructions for staging environment setup (likely branch strategy, env config, and deployment pipeline).
