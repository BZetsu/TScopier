# Project Memory

## Changelog

### 2026-07-28 — Telegram reconnect storm fixes (11 fixes) — ALL TESTS PASS

- **Context:** Deployment `af12737d` caused all users' Telegram listeners to enter a death spiral of disconnect/reconnect. Root cause: 10 flat-30s reconnect attempts (273s cycle) replaced the original 4 escalating + deferred retry (56s). GramJS internal crashes also triggered reconnects. 83% of log noise was GramJS flood-wait suppression messages.
- **11 fixes applied on `feat/fix-telegram-reconnect-storm`:**
  - **Fix 1-2:** `authKeyDuplicatedRecovery.ts` — max attempts 10→4, delays `[first, retry, 15s, 30s]`, deferred retry restored
  - **Fix 3:** `userListener.ts:noteMalformedRpcResult` — no longer triggers `requestReconnect`
  - **Fix 4-6:** `userListener.ts:requestReconnect` — cycleId (8-char UUID), cooldown gate, deferred retry
  - **Fix 7:** `authKeyDuplicatedRecovery.test.ts` — expectations updated for new defaults
  - **Fix 8:** `authService.ts` — `logAuthEvent()` with correlationId, timing per step, error categorization
  - **Fix 9-10:** `gramjsLogSuppress.ts` (NEW) — monkey-patches `console.log` to suppress `Sleeping for Xs on flood wait`, aggregates per 60s window
  - **Fix 11:** `userListener.ts:startHeartbeat()` — fires `listener_healthy` trace every 60s
- **Files:** `worker/src/authKeyDuplicatedRecovery.ts`, `worker/src/authKeyDuplicatedRecovery.test.ts`, `worker/src/userListener.ts`, `worker/src/authService.ts`, `worker/src/gramjsLogSuppress.ts` (NEW), `worker/src/index.ts`
- **Verification:** 18/18 tests pass (`authKeyDuplicatedRecovery` + `gramjsMalformedRpcResultPatch`). `npm run build` passes clean.
- **Follow-up:** Push to `origin/feat/fix-telegram-reconnect-storm`, open PR to upstream/dev.

### 2026-07-28 — Staging test checklist + Marti's 8 commits merged + Section 5 promoted

- **Context:** Created comprehensive staging test checklist (`docs/staging-test-checklist.md`) covering all 6 sections plus Martins' 8 commits. Pushed all changes (Section 5 + Martins commits + existing fixes) to both upstream/dev and upstream/staging at `964152e3`. dev and staging are now identical.
- **Martins' 8 commits analyzed:**
  - `186c8d1c` ensureSignalRow — MEDIUM risk (signal FK persistence)
  - `5dd36c5b` SL/TP validation — MEDIUM risk (near-market stop stripping)
  - `6274eb78` order close audit — LOW risk (observability)
  - `03d21caf` basket layering — HIGH risk (flat-basket purge behavior change)
  - `5ed2571c` reconciliation — HIGH risk (pre-claim stale check ordering)
  - `15c1e04d` test fixes — LOW risk (test-only)
  - `cf31c7e8` ListenerLeaseOfflineBanner — LOW risk (frontend UI)
  - `70de046f` CopierStatusCard + purge cron — HIGH risk (5-min cleanup cron)
- **Files:** `docs/staging-test-checklist.md`, `docs/weekly-plan-2026-07-27.md`, `docs/PROJECT_MEMORY.md`
- **Follow-up:** Run through staging test checklist before production rollout.

### 2026-07-28 — Section 5: Realtime subscription reconnect gap fix

- **Context:** Implemented Section 5 of the weekly plan — Supabase Realtime WebSocket drops every 20-40 min but the reference is never cleared, so the guard (`if (this.channelChannel) return`) prevents re-subscription forever.
- **Changes:**
  - **5.1:** Both `subscribeToChannelChanges()` and `subscribeToAuthPendingChanges()` now null the channel reference on `CLOSED`/`CHANNEL_ERROR` and schedule a re-subscribe via `setTimeout(..., 5000)`
  - **5.2:** Added `startRealtimeHealthCheck()` / `stopRealtimeHealthCheck()` — 60s interval that checks if subscription references are non-null; if missing, re-subscribes. Started in `loadAll()`, stopped in `stopChannelListenerServices()` and `disconnectAll()`
- **Files:** `worker/src/sessionManager.ts`
- **Verification:** All 19 tests pass (10 channelInvalidAutoDisable, 2 sessionManager shutdown, 7 AUTH_KEY_DUPLICATED lifecycle)
- **Follow-up:** PR to upstream/dev, then promote to staging

### 2026-07-28 — PR #49 review: CHANNEL_INVALID auto-disable (Section 4) — ALL PASS

- **Context:** Reviewed PR #49 (commit `991bf6d2`, merged at `a6ed746a`) against Section 4 of the weekly plan. All 10 tests pass, all 4 checklist items covered.
- **Verification results:**
  - **4.1:** `ChannelInvalidFailureState` interface (line 276) + `channelInvalidFailures` Map (line 403) — DONE ✅
  - **4.2:** Increment on CHANNEL_INVALID in all callers: `pollChannelNewMessages` (3308, 3343), `warmChannelEntity` (3470), `catchUpChannel` (3524), `ensureJoinedPublicChannel` (3202) — DONE ✅
  - **4.3:** Threshold (default 5) triggers DB `is_active=false` update (596-599), log (618-631), `removeChannelFromMonitoring` (581), `channel_auto_disabled` event (625) — DONE ✅
  - **4.4:** `isConfirmedChannelInvalidError` includes `USERNAME_NOT_OCCUPIED`/`USERNAME_INVALID` (352-357), handled in `ensureJoinedPublicChannel` at line 3202 — DONE ✅
- **Test results:** `UserListener channel invalid auto-disable` — all 10/10 tests passing
- **Files:** `worker/src/userListener.ts`, `worker/src/channelInvalidAutoDisable.test.ts`, `docs/weekly-plan-2026-07-27.md`
- **Follow-up:** Promote PR #49 from upstream/dev to upstream/staging. Update weekly plan PDF.

### 2026-07-27 — Section 6 scale validation: prod data copied to staging, listener restart triggered

- **Context:** Set up 59 synthetic sessions + 170 channels on staging by copying production data safely (no session strings, all PII blanked). Deleted 34 orphaned synthetic users from earlier failed script runs. Ready to monitor.
- **Changes:**
  - Created `scripts/section6-scale-test.js` — idempotent script that exports production sessions/channels/profiles, creates staging auth users (detects existing by email), upserts data, removes orphans
  - Ran script: 59 sessions, 170 channels, 59 profiles inserted into staging. 34 orphan profiles deleted.
  - Fixed `worker/Dockerfile` — `COPY scripts ./scripts` before `npm ci` in both build and runtime stages (postinstall patch script was missing, causing Railway build failure)
- **Files:** `scripts/section6-scale-test.js`, `worker/Dockerfile`, `docs/weekly-plan-2026-07-27.md`, `docs/weekly-plan-2026-07-27.pdf`
- **Verification:** 62 sessions (3 real + 59 synthetic), 62 profiles, 174 channels on staging. 0 orphans. All 3 real staging users intact.
- **Follow-up:** Monitor staging for 4h (6.3), then production rollout (6.4).

### 2026-07-27 — Completed remaining fix items 2.4, 3.2, + patch script security

- **Context:** After PRs #47 and #48, items 2.4 and 3.2 were still PARTIAL. Completed them plus hardened the patch script.
- **Changes:**
  - **2.4:** Added `[telegram-conn]` connect-trace log in `telegramClient.ts:buildClient()` with redacted session fingerprint (`worker/src/telegramClient.ts`)
  - **3.2:** Added `readUInt32LE` / `Cannot read properties of undefined` raw error string fallbacks in `onError` handler, routing to `noteMalformedRpcResult` (`worker/src/userListener.ts`)
  - **Patch script security:** Added version assertion (checks telegram package version matches 2.26.22), post-application content verification (verifies markers exist after patching), and enhanced `--check` mode (`worker/scripts/apply-node-module-patches.cjs`)
- **Files:** `worker/src/telegramClient.ts`, `worker/src/userListener.ts`, `worker/scripts/apply-node-module-patches.cjs`, `docs/weekly-plan-2026-07-27.md`
- **Verification:** All 6 existing patch tests pass. Patch script runs clean with `--check` and without. Post-patch verification confirms markers present.
- **Follow-up:** Ready to promote dev → staging and start Section 4 (CHANNEL_INVALID).

### 2026-07-27 — Verified all claims in weekly plan, regenerated PDF, fixed 3 doc inaccuracies

- **Context:** Ran comprehensive claim verification across all 6 sections of `docs/weekly-plan-2026-07-27.md` using 5 explore subagents. Found and fixed 3 inaccuracies. Regenerated the PDF with proper wkhtmltopdf CSS (tighter margins, no squished content, proper line spacing, table page-break handling).
- **Verification results:**
  - **Section 1 (merge staging):** ALL CONFIRMED — 16 commits ahead, 9 specific hashes on staging, migration file exists, auth fixes on both branches via different hashes
  - **Section 2 (AUTH_KEY_DUPLICATED):** ALL CONFIRMED — SIGTERM handler at 258, AUTH_KEY_DUP_RECONNECT_DELAY_MS at 190-192, hardcoded 8_000 at sessionManager.ts:784, orphaned lease path in startListener, infinite forceReconnect loop at userListener.ts:3548-3617. Also discovered: drain timeout capped at 10_000ms via Math.min(10_000, ...) — item 2.1 must also remove/increase this cap. releaseAllLeases() does not exist (needs creation).
  - **Section 3 (BinaryReader crash):** BinaryReader guard gap CONFIRMED at lines 545 and 568. _recvLoop error handler PARTIALLY REFUTED — log is at line 451 (not 441), RPCError handled without logging, outer catch (line 375) returns instead of continuing.
  - **Section 4 (CHANNEL_INVALID):** ALL CONFIRMED — resolveChannelPeer at 3175 has no CHANNEL_INVALID handling, ensureJoinedPublicChannel at 2896 suppresses USER_ALREADY_PARTICIPANT/CHANNELS_TOO_MUCH/INVITE_HASH_EMPTY but not CHANNEL_INVALID, zero CHANNEL_INVALID references across entire codebase.
  - **Section 5 (Realtime reconnect):** subscribeToChannelChanges guard at 336 CONFIRMED. subscribeToAuthPendingChanges guard variable name REFUTED — uses `this.authPendingChannel` not `this.channelChannel` (line 364). CLOSED/CHANNEL_ERROR only log warnings, no reference clearing — CONFIRMED.
  - **Sections 1 & 6 (commits, migrations):** ALL CONFIRMED — all 16 commits on staging, migration file present.
- **Doc fixes applied:**
  1. Section 2: Added caveat about `Math.min(10_000, ...)` cap on drain timeout
  2. Section 3: Fixed _recvLoop catch line from 441 to 451, added detail about two catch blocks
  3. Section 5: Fixed guard variable name from `this.channelChannel` to `this.authPendingChannel`, added correct line 364
- **PDF regeneration:** Created custom CSS with @page { margin: 5mm 6mm }, body line-height 1.6, font-size 9pt, table row page-break-inside:avoid, thead table-header-group. Overrode pandoc default `max-width: 36em` which was causing squished content. 4 pages, clean rendering.
- **Files:** `docs/weekly-plan-2026-07-27.md`, `docs/weekly-plan-2026-07-27.pdf`
- **Follow-up:** Ready for implementation — each section's fix items are independently actionable.

### 2026-07-27 — Production log analysis: found 3 gaps in weekly plan, added items 2.5, 2.6, and BinaryReader line fix

- **Context:** Reviewed fresh production log stream from the user. Identified 3 patterns not fully covered in the existing plan:
  1. **Lease cleanup race on startup (2.5):** The `disconnectAll()` in shutdown only releases leases for listeners in the in-memory map. Sessions mid-connect or errored leave orphaned leases that block the new worker for up to 41s.
  2. **Stale "auth in progress" state (2.6):** Once a session exhausts AUTH_KEY_DUPLICATED retries, it falls into `auth_pending` state and gets skipped every `syncSessions()` cycle forever. The user sees "linking Telegram" in the UI but never recovers.
  3. **BinaryReader line number (Section 3):** The crash is at `MTProtoSender.js:546` (the `!state` branch), not `:568` (the `state` branch). Both branches lack a guard, but the active path is 546.
- **Changes:**
  - Added items 2.5 and 2.6 to `docs/weekly-plan-2026-07-27.md`
  - Fixed BinaryReader line reference in Section 3 from `:568` to `:546`
- **Files:** `docs/weekly-plan-2026-07-27.md`
- **Follow-up:** Start implementing Section 1 (merge staging → production). Then proceed through Sections 2-6 in order.

### 2026-07-27 — Documented weekly plan: production vs staging gap analysis + 6-section fix checklist

- **Context:** Analyzed production logs (53 sessions, build channel-scoped-listener-1) vs staging logs (3 sessions). Mapped every production error to root cause and staging fix status. Documented what's on staging that production needs, plus the 5 remaining unfixed production issues.
- **Changes:**
  - Created `docs/weekly-plan-2026-07-27.md` — comprehensive checklist with 6 sections, each containing: plain English fix description, technical detail, plain English explanation, user impact, expected outcome, and actionable checklist items
  - Key finding: Only TIMEOUT handler fix (`b3a8f38a`) and QR login fix (`ef01e883`) are ready to merge from staging. AUTH_KEY_DUPLICATED, BinaryReader crash, CHANNEL_INVALID, and Realtime subscription reconnect gap all need new code.
  - Last production merge was PR #43 (`01a2d913`) — auth-fixes-to-main on Jul 23.
- **Files:** `docs/weekly-plan-2026-07-27.md`
- **Follow-up:** Week 1 implementation — start with Section 1 (merge staging) then proceed through remaining sections.

### 2026-07-24 — Fixed _updateLoop TIMEOUT handler: missing `await` broke reconnect

- **Context:** The `onError` TIMEOUT handler pushed to staging (commit 0218a215) called `this.requestReconnect()` without `await`. The `_updateLoop` would continue pinging on the dead connection while `forceReconnect` ran in the background. The `this.isConnected` guard then made things worse — after the first TIMEOUT, `forceReconnect` set `isConnected = false`, and all subsequent TIMEOUTs were silently skipped. The loop kept spinning forever on TIMEOUTs.
- **Changes:** Added `await` before `this.requestReconnect()` so the old `_updateLoop` blocks until the reconnect completes. Removed `this.isConnected` guard — `reconnectInFlight` dedup already prevents concurrent reconnects.
- **Files:** `worker/src/userListener.ts:364`
- **Follow-up:** Pushed directly to `upstream/dev` and `upstream/staging` (both at `b3a8f38a`). Staging logs verified: no TIMEOUT errors after deploy.

### 2026-07-24 — Promoted QR login AUTH_KEY_UNREGISTERED fix to staging

- **Context:** The fix was previously committed to `upstream/dev` only. `upstream/staging` was behind `dev` and missing this fix.
- **Changes:** Pushed to `upstream/staging` along with the TIMEOUT handler fix. Both branches now identical at `b3a8f38a`.

### 2026-07-24 — Added pipeline_ts column to signals table on staging Supabase

- **Context:** Staging logs showed `Could not find the 'pipeline_ts' column of 'signals' in the schema cache`. The column existed on `channel_signals` (canonical) but not on `signals` (per-user projection). The listener code writes `pipeline_ts` on signal upsert.
- **Changes:** Created and applied migration `20260724120000_signals_pipeline_ts.sql` on staging project `axdcledcyhyvzrnfkwat`. Column `pipeline_ts jsonb` added to `signals` table.
- **Files:** `supabase/migrations/20260724120000_signals_pipeline_ts.sql`
- **Follow-up:** Ensure this migration is included in future PRs to avoid reapplying.

### 2026-07-24 — Identified missing TRADE_WORKER_URL on staging listener

- **Context:** Staging logs show `[tradeSignalPush] no trade worker URL for action=sell user=ed0ab337... — set TRADE_WORKER_URL / TRADE_MGMT_WORKER_URL on listener`. Listener cannot forward signals to trade worker.
- **Fix:** Set Railway secrets on listener service: `TRADE_WORKER_URL=https://tscopier-staging.up.railway.app` and `TRADE_MGMT_WORKER_URL=https://tscopier-staging.up.railway.app`.

### 2026-07-24 — Fixed QR login AUTH_KEY_UNREGISTERED death spiral

- **Context:** User `4d2c9a06` attempted QR login, but the Telegram auth key was already unregistered. `onError` handler in `runQrLoginBackground` returned `false` (meaning "not fatal, keep trying"), so GramJS looped `account.GetPassword` → `AUTH_KEY_UNREGISTERED` → `onError` forever, spamming logs every ~200ms.
- **Changes:** Added `isAuthKeyUnregistered` check in the `onError` callback that throws instead of returning `false`, breaking the retry loop. The outer `catch` handler then properly cleans up pending state, disconnects the client, and marks the QR login as errored.
- **Files:** `worker/src/authService.ts:396`
- **Follow-up:** Push to staging once verified on dev.

### 2026-07-23 — Fixed _updateLoop TIMEOUT death spiral for connected user listeners

- **Context:** Connected user listeners logging `Error: TIMEOUT` every 9-30 seconds from GramJS's `_updateLoop` ping loop, never recovering. Caused by `autoReconnect: false` setting — `client._sender.reconnect()` silently no-ops when `_userConnected` is false, so the loop repeats forever.
- **Changes:** Registered `client.onError` handler in `UserListener` constructor that catches TIMEOUT errors and calls `requestReconnect('update_loop_timeout')`, forcing a proper disconnect + reconnect cycle that actually tears down and rebuilds the connection.
- **Files:** `worker/src/userListener.ts:359`
- **Follow-up:** Converge on dev branch tomorrow with any fixes, then promote to staging.

### 2026-07-23 — Fixed Telegram auth: session persistence, GramJS timeout recovery, error code propagation

- **Context:** Three auth bugs found during staging testing:
  1. Railway worker restart between `send_code` and `verify_code` lost MTProto session → "Login session expired"
  2. GramJS `_updateLoop` entered a TIMEOUT death spiral after a connection drop mid-auth, making the client unusable for 30+ minutes
  3. Error responses only had a human-readable `error` field — no stable `code` for the frontend to detect specific error types
- **Changes:**
  - **Session persistence:** Save GramJS `StringSession` during `sendCode` into `telegram_auth_pending.auth_session_string` so worker restarts don't break `sendCode` → `signIn` binding
  - **GramJS timeout recovery:** Reconnect disconnected client before `tgInvoke` in `verifyCode`; classify "cannot send requests while disconnected" as recoverable
  - **Error code propagation:** New `clientErrorPayload()` sends `error`, `message`, and stable `code` (e.g. `NO_PENDING_PHONE_AUTH`) in error responses; edge function sanitizes `message` field too
  - **Realtime migration:** Enable `telegram_auth_pending` in supabase realtime publication
- **Files:** `worker/src/authService.ts`, `worker/src/telegramAuthRecovery.ts`, `worker/src/httpServer.ts`, `worker/src/httpServer.authErrors.test.ts`, `supabase/functions/telegram-auth/index.ts`, `supabase/migrations/20260722150000_telegram_auth_pending_realtime.sql`, `docs/PROJECT_MEMORY.md`
- **Follow-up:** Retry Telegram auth flow on staging after deploy.

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
