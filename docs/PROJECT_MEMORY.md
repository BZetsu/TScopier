# Project Memory

## Changelog

### 2026-07-31 — Fixed staging Netlify build: layering fallback type error in AccountConfigPage

- **Context:** Staging frontend deploy (`BZetsu/TScopier:staging` → Netlify) failed with 7 TS errors in `src/pages/dashboard/AccountConfigPage.tsx` after pulling Emma's layering-modes commits (PRs #63–#65, `8be5388e`) from upstream staging. The build is `tsc -b && vite build`, so `tsc` blocked the deploy.
- **Root cause:** The ternary `normalizedFallbackManual` had two branches: `normalizeManualSettings(...) as ManualSettings` and `(configAccount.manual_settings ?? {})`. `configAccount.manual_settings` is typed `Json | null` (`src/types/database.ts`), so the fallback branch widened the union to `ManualSettings | Json`, and `.layering_mode` / `.range_layering_type` / `.static_layer_count` / `.dynamic_step_pips` / `.dynamic_max_layers` were not accessible on the `string` member of the union.
- **Changes:**
  - **`src/pages/dashboard/AccountConfigPage.tsx`:** Cast the fallback branch to `ManualSettings`: `: (configAccount.manual_settings ?? {}) as ManualSettings`. Pure type-level fix — zero runtime behavior change (all accessed fields already fall back via `===` checks and `?? DEFAULT_MANUAL_SETTINGS.*`).
- **Verification:** `npx tsc -b` clean on the staging checkout.
- **Deploy:** Commit `7ce4baea` pushed to `origin/staging` → Netlify rebuild triggered.
- **Follow-up:** `upstream/staging` still contains the broken commit `8be5388e` without the fix — needs the same commit (or a PR) to keep forks in sync. Also worth cherry-picking the fix to `dev`/`main` later via the normal hotfix flow.

### 2026-07-31 — Added "Manage" button to trade detail modal (deep-link into Manage Signals edit modal)

- **Context:** On the Trades page (`/account-trades`), clicking a trade opens `TradeDetailModal`. User wanted a "Manage" button in the modal header that jumps to the manage signals page (`/manage-signals`) and opens the exact `EditSignalOverrideModal` for that trade's linked signal.
- **Changes:**
  - **`src/components/trades/TradeDetailModal.tsx`:** Added "Manage" button in the sticky header, before the X close button. Uses `useNavigate`; on click closes the modal and navigates to `/manage-signals?edit=<signalId>`. Disabled until the linked signal context resolves (`context?.signal?.id`).
  - **`src/pages/dashboard/SignalHistoryPage.tsx`:** Reads `?edit=` search param. Once data is loaded, resolves the signal (direct entry signal, or via `resolveManagementAnchorEntryId` for management signals), verifies open status, then calls `handleSelectSignal` → opens `EditSignalOverrideModal`. Only fires once per param value (`handledEditSignalIdRef`). Closing the modal strips the `edit` param (`setSearchParams({}, { replace: true })`) so refresh doesn't re-open it.
  - **i18n:** Added `trades.manage` key to `types.ts` + all 9 locales (en/es/fr inline, ar/pl/ru/nl/ja/sv in `locales/trading/`).
- **Design decisions:** Modal only auto-opens for OPEN signals (matches page interaction model — closed rows aren't clickable). If the signal isn't in the last 500 loaded signals, user just lands on the page. No URL params were previously used on this page, so no conflicts with existing state.
- **Files:** `src/components/trades/TradeDetailModal.tsx`, `src/pages/dashboard/SignalHistoryPage.tsx`, `src/i18n/locales/types.ts`, `src/i18n/locales/{en,es,fr}.ts`, `src/i18n/locales/trading/{ar,pl,ru,nl,ja,sv}.ts`
- **Verification:** `tsc -b` clean, `vite build` clean, all 265 tests pass, lint — 0 new errors (5 pre-existing errors in these files, all on untouched lines, confirmed by stash-compare).
- **Follow-up:** None.

### 2026-07-31 — Merged upstream/main (prod) into feat/remaining-weekly-plan-items

- **Context:** User requested pulling the latest push from prod before continuing feature work. Current branch had diverged; merge had 2 conflicts (`worker/.env.example`, `worker/src/sessionManager.ts`).
- **What prod brought in (commit `f04282e2` "feat: enhance session management with new listener timeout and healing logic"):**
  - **Disconnected-listener healing:** New `disconnectedRenewTicks` Map counter in `UserSessionManager`. If a listener stays disconnected for N renew ticks (`LISTENER_DISCONNECT_HEAL_TICKS`, default 3 ≈ 60s), it hard-resets via `stopListener()` so `syncSessions` can restart cleanly. Prevents "No lease forever" / UI "Copier engine offline" from a wedged reconnect-only path.
  - **Start timeouts:** `listener.start()`, `syncSessions startListener`, and listener startup wrapped in `withTimeout` (60s default, `LISTENER_START_TIMEOUT_MS`).
  - **Start failure handling:** explicit `listener.stop()` + direct `telegram_sessions`/`telegram_auth_pending` deletes (avoids deadlock with `invalidateTelegramSession` under connection lock).
  - **userListener.ts:** `warmEntityCache()` no longer awaited on start (fire-and-forget + `startEntityWarmup`), because hung `getDialogs` blocked `startListener` and left users with No lease.
  - **`.env.example`:** 3 new knobs — `LISTENER_START_TIMEOUT_MS`, `LISTENER_DISCONNECT_HEAL_TICKS`, `TELEGRAM_RECONNECT_COOLDOWN_MS`.
- **Conflict resolution decisions:**
  - `.env.example`: kept BOTH Sentry config (feature branch) and listener knobs (prod).
  - `sessionManager.ts` disconnected branch: kept prod's hard-reset healing logic + retained feature branch's `console.log` renew message.
  - `syncSessions`: kept BOTH `recentlyFailed` cooldown (feature branch) AND prod's `withTimeout`.
  - startListener success path: kept both `recentlyFailed.delete` and `disconnectedRenewTicks.delete`.
- **Files:** `worker/.env.example`, `worker/src/sessionManager.ts`, `worker/src/userListener.ts`
- **Verification:** conflict markers removed, `npx tsc -p worker/tsconfig.json --noEmit` clean (installed `@sentry/node` in worker/ to satisfy the feature branch's Sentry import).
- **Follow-up:** stash@{0} still holds pre-merge build artifacts (dist/, worker/dist/) — left untouched. Commit `282a57a9`.

### 2026-07-30 — Added DB trigger to update signal_channels.last_live_at on all signal inserts

- **Context:** `signal_channels.last_live_at` was only updated by the canonical ingest pipeline (elected reader). The Python listener and legacy TS listener write directly to the per-user `signals` table, so `last_live_at` stayed null for those channels. `channel_signals` was also empty. The PopularChannelsPage showed "No activity recorded" despite active trades.
- **Root cause:** No mechanism existed to propagate per-user signal creation back to the global `signal_channels.last_live_at`.
- **Changes:**
  - Added `bump_signal_channel_last_live()` trigger function
  - Added `trg_bump_signal_channel_last_live` trigger on `signals` (AFTER INSERT)
  - On each signal insert, joins through `telegram_channels.signal_channel_id` and updates `signal_channels.last_live_at` if the new `created_at` is more recent
- **Files:** `supabase/migrations/20260730120000_signal_channels_last_live_trigger.sql`
- **Verification:** Lint clean, all 265 tests pass
- **Follow-up:** After deploying the migration, existing channels will show activity once their next signal arrives. No backfill needed.

### 2026-07-30 — Fixed PopularChannelsPage search (controlled input + live filtering) and sort filter icon

- **Context:** Search input used `defaultValue` (uncontrolled) so filtering only triggered on Enter/click — users expected live filtering as they typed. Sort dropdown had no visual indicator it was a filter, looked like a plain button.
- **Changes:**
  - Made search input controlled: `value={searchQuery}` + `onChange` for real-time filtering
  - Removed unnecessary `inputRef` and search button click handler
  - Added `ListFilter` icon inside the sort dropdown with left padding
  - Added `ChevronDown` arrow on right of sort dropdown for visual affordance
- **Files:** `src/pages/dashboard/PopularChannelsPage.tsx`
- **Verification:** `tsc -b && vite build` clean
- **Follow-up:** None

### 2026-07-30 — Added search text highlighting in PopularChannelsPage results

- **Context:** When searching channels, matched text in `display_name` and `channel_username` wasn't highlighted, making it hard to see why a result matched.
- **Changes:**
  - Added `highlightText()` helper that splits text by the query and wraps matches in a `<mark>` element with yellow background
  - Applied highlighting to `display_name` and `channel_username` in both collapsed rows and expanded detail view
- **Files:** `src/pages/dashboard/PopularChannelsPage.tsx`
- **Verification:** Lint clean, all 265 tests pass
- **Follow-up:** None

### 2026-07-30 — Added Discover section to sidebar, moved Popular Channels into it

- **Context:** Popular Channels was under SIGNALS in the sidebar. User requested a new DISCOVER section between SIGNALS and TRADING TOOLS with Popular Channels moved there.
- **Changes:**
  - Added `discover` to `NavTranslations.sections` type in `types.ts`
  - Added `discover` translation in all 9 locale files (en, es, fr, chrome/ar, chrome/pl, chrome/ru, chrome/nl, chrome/ja, chrome/sv)
  - Moved Popular Channels from SIGNALS section to new DISCOVER section in `AppLayout.tsx`
- **Files:** `src/i18n/locales/types.ts`, `src/components/layout/AppLayout.tsx`, `src/i18n/locales/en.ts`, `src/i18n/locales/es.ts`, `src/i18n/locales/fr.ts`, `src/i18n/locales/chrome/ar.ts`, `src/i18n/locales/chrome/pl.ts`, `src/i18n/locales/chrome/ru.ts`, `src/i18n/locales/chrome/nl.ts`, `src/i18n/locales/chrome/ja.ts`, `src/i18n/locales/chrome/sv.ts`
- **Verification:** `tsc -b && vite build` clean
- **Follow-up:** None

### 2026-07-30 — Added search button + sort dropdown to PopularChannelsPage; fixed lint issues

- **Context:** Search icon was decorative (`pointer-events-none`) and didn't trigger search. Sort filters were inline buttons that didn't work well on mobile. Three pre-existing lint errors blocked clean CI.
- **Changes:**
  - Search icon is now a clickable button — triggers filter on click or Enter key
  - Added clear (X) button when search is active
  - Replaced inline sort filter buttons with a styled Select dropdown
  - Fixed 3 pre-existing lint errors: removed dead `channelsRef`, reordered `loadChannels` before `useEffect`, changed `let` to `const`
- **Files:** `src/pages/dashboard/PopularChannelsPage.tsx`
- **Verification:** Lint clean, all 265 tests pass
- **Follow-up:** None

### 2026-07-30 — Fixed "No activity recorded" for channels with signals but null last_live_at

- **Context:** `PopularChannelsPage` showed "No activity recorded" for channels where `signal_channels.last_live_at` was null, even though the channels had generated signals (visible in `channel_signals` table) and had executed trades. The `channelStatus()` function only checked `last_live_at` — if null, it immediately returned "No activity recorded" with no fallback.
- **Changes:**
  - Modified the `channel_signals` query in `loadChannels()` to also fetch `created_at` (with descending sort), computing the latest signal timestamp per channel into a new `lastSignalAt` map
  - Updated `channelStatus()` to accept an optional `lastSignalAt` parameter — uses it as fallback when `last_live_at` is null
  - Updated "Recently active" sort to fall back to latest signal timestamp when `last_live_at` is null
  - Updated expanded view's "Last activity" row to show latest signal timestamp with "(by signal)" suffix when `last_live_at` is null
- **Files:** `src/pages/dashboard/PopularChannelsPage.tsx`
- **Verification:** Insufficient — `channel_signals` was also empty for Python listener paths; required the DB trigger below to fix globally
- **Follow-up:** Superseded by the `bump_signal_channel_last_live` trigger migration

### 2026-07-29 — Added [httpServer] debug logging for Telegram auth + pushed all commits to dev/staging

- **Context:** Uncommitted debug logging for Telegram auth endpoints (`send_code`, `verify_code`, `start_qr`, `qr_status`, `verify_qr_password`) was left from the July 23-24 auth debugging sessions. Added and committed after verifying no sensitive data is logged (phone numbers redacted, no passwords or secrets).
- **Changes:**
  - Added `console.log`/`console.warn` with `[httpServer]` prefix before and after each auth handler call, logging user_id and action outcome
  - Redacted phone number from `send_code` log line
- **Files:** `worker/src/httpServer.ts`
- **Verification:** Reviewed full diff — no secrets exposed
- **Follow-up:** None

### 2026-07-29 — Fixed channelTradingConfig healing loop: persisted healed configs to DB

- **Context:** `healChannelTradingConfigsMap()` created default per-channel trading settings in memory for channels missing config, but never wrote them to the database. Every signal dispatch re-detected the missing config, re-healed, and logged the warning. For channel `daa27d5a-e17e-4025-904e-8da28a4e30f4` this repeated every ~60s forever.
- **Root cause:** The function was a pure in-memory computation — it produced healed configs, returned them for execution, then discarded them. The `broker_accounts.channel_trading_configs` JSONB column and `broker_channel_trading_configs` table were never updated, so every call re-read stale DB data.
- **Changes:**
  - Added `persistHealedChannelConfigs()` in `channelTradingConfig.ts` — compares original vs healed configs, upserts newly healed channels to `broker_channel_trading_configs` table
  - Wired into `TradeExecutor.ts:loadBrokers()` (bulk startup path) and `TradeExecutor.ts:applyBrokerCacheRow()` (all real-time paths) — captures original configs before normalization, persists after
  - Added `SupabaseClient` import to `channelTradingConfig.ts`
- **Files:** `worker/src/channelTradingConfig.ts`, `worker/src/tradeExecutor/TradeExecutor.ts`
- **Verification:** `tsc` build clean, all 13 `channelTradingConfig` tests pass
- **Follow-up:** After deploy, the "healed missing per-channel config" warning should fire once per channel and then stop permanently

### 2026-07-29 — Added popularChannelsPage translations to all locale files

- **Context:** `popularChannelsPage` section was added to `en.ts` and `types.ts` but missing from other locale files that define `channelsPage`.
- **Changes:**
  - Added `popularChannelsPage` with Spanish translations to `es.ts`
  - Added `popularChannelsPage` with French translations to `fr.ts`
  - Added `popularChannelsPage` (English fallback) to `trading/ar.ts`, `trading/pl.ts`, `trading/ru.ts`, `trading/nl.ts`, `trading/ja.ts`, `trading/sv.ts`
  - Added `'popularChannelsPage'` to the `Pick` in `trading/types.ts` to resolve TS2353
- **Files:** `src/i18n/locales/es.ts`, `src/i18n/locales/fr.ts`, `src/i18n/locales/trading/ar.ts`, `src/i18n/locales/trading/pl.ts`, `src/i18n/locales/trading/ru.ts`, `src/i18n/locales/trading/nl.ts`, `src/i18n/locales/trading/ja.ts`, `src/i18n/locales/trading/sv.ts`, `src/i18n/locales/trading/types.ts`
- **Verification:** `npm run build` passes clean
- **Follow-up:** None

### 2026-07-29 — Added recentlyFailed cooldown to syncSessions + fixed stale tests

- **Context:** User `6b0410f1` stuck in AUTH_KEY_DUPLICATED retry storm — `syncSessions` retried every 30s forever with no cooldown.
- **Changes:**
  - Added `recentlyFailed: Map<string, number>` field to `UserSessionManager` — tracks `userId → timestamp` of last start failure
  - In `syncSessions()`: checks `recentlyFailed` before calling `startListener` — if user failed within cooldown window (env `TELEGRAM_RETRY_COOLDOWN_MS`, default 5min, range 30s-1h), skips them
  - On success (in `startListener`): clears the failure entry so any successful start resets the cooldown
  - Fixed 4 stale tests in `sessionManager.shutdown.test.ts` that expected malformed RPC results to trigger reconnect — the hotfix (Fix 3) changed this to count-only, no reconnect
- **Files:** `worker/src/sessionManager.ts` (lines 89-90, 593-612, 1143), `worker/src/sessionManager.shutdown.test.ts` (4 updated tests)
- **Verification:** `tsc` build clean, all 9/9 tests pass
- **Follow-up:** Push to upstream/dev and promote to staging/production

### 2026-07-29 — Popular Channels discovery page added

- **Context:** New informational page under the SIGNALS section that lists all `signal_channels` ranked by `subscriber_count` descending. Purely a discovery directory — users cannot add channels from this page (they must join on Telegram first).
- **Change:**
  - Created `src/pages/dashboard/PopularChannelsPage.tsx` — queries `signal_channels` ordered by subscriber count, renders a Card with rank (#1, #2...), display name, @username, live/offline indicator, and subscriber count
  - Added route `/popular-channels` in `App.tsx` with lazy loading
  - Added nav item `Popular Channels` with `Flame` icon to SIGNALS section in `AppLayout.tsx`
  - Added `/popular-channels` to subscription-free access set in `subscriptionNavAccess.ts`
  - Added i18n: `popularChannels` key to `NavTranslations.items` in `types.ts` and all locales
  - Added `Flame` import and icon mapping in `appNavIcons.ts`
- **Updated later same day:**
  - Click-to-expand rows showing Channel ID, first seen, subscribers, last activity date
  - Search bar filtering by channel name or username
  - Sort tabs: Most subscribers, Most signals, Recently active, Newest first
  - Status display now uses 3 tiers: Live (<1h), Active Xm ago (<24h), Last active X ago
  - Shows "X subscribers" text label instead of bare number
  - Fixed "No recent activity" appearing when data was fresh (was only checking 1h window; now shows relative time for older entries too)
  - Expanded details now show channel name with copy button, username with copy, Channel ID with copy, signal count from channel_signals
  - Batch query counts signals per channel from channel_signals table for performance metric
  - CopyButton component with checkmark feedback on each copyable field
- **Files:** `src/pages/dashboard/PopularChannelsPage.tsx` (NEW), `src/App.tsx`, `src/components/layout/AppLayout.tsx`, `src/lib/appNavIcons.ts`, `src/lib/subscriptionNavAccess.ts`, `src/i18n/locales/types.ts`, `src/i18n/locales/en.ts`
- **Verification:** `tsc -b --noEmit` + `vite build` pass clean
- **Follow-up:** None

### 2026-07-28 — Hotfix deployed to production (reconnect storm), 3 remaining issues identified

- **Context:** Hotfix PR #53 (reconnect storm: 11 hardening fixes + realtime health check + reconnect monkeypatch + signals_pipeline_ts migration) was cherry-picked from staging into `upstream/main` via `origin/hotfix/reconnect-storm`. Merged at `e7df374c`. Production deployment confirmed working: flood-wait aggregated (`count=18 window=60s`), malformed RPC counted but NOT triggering reconnects, 9+ listeners connected with heartbeats.
- **Production log findings:**
  1. **"Copier engine offline" on production** — Driven by `worker_session_leases` table. `renewAllLeases` runs every 20s with per-user 8s timeout, concurrency 6, lease TTL 45s. Need to verify leases are being written properly on production.
  2. **User `6b0410f1` stuck in AUTH_KEY_DUPLICATED retry loop** — `syncSessions` runs every 30s, sees user not in `this.listeners`, tries `startListener` → AUTH_KEY_DUPLICATED → fails. Repeats forever. No recentlyFailed cooldown. Old Telegram session still alive elsewhere.
  3. **FxSocket terminal pod provisioning failure on production** — Broker `2c8a5239`: `Terminal pod not ready within 10 minutes`. Broker `58358b99`: `heartbeat keepSessionAlive failed`. Staging (4 brokers, 3 users) works fine with same API key. Production has 100 brokers, 42 users — likely FxSocket infrastructure issue at scale.
  4. **Stale callback risk** in `sessionManager.ts:startRealtimeHealthCheck` — interval checks `if (!this.channelChannel)` but callback could fire after reference is already reassigned.
- **Files:** `worker/src/index.ts` (lease + sync intervals), `worker/src/sessionManager.ts` (renewAllLeases, syncSessions), `worker/src/sessionLease.ts` (acquireSessionLease), `worker/src/fxsocketClient.ts` (checkConnect / keepSessionAlive)
- **Verification:** Production logs confirm fix running (build=channel-scoped-listener-1). `[fxsocketClient] flood-wait_occurred count=18 window=60s`. No reconnect storms.
- **Follow-up:** 1) Fix recentlyFailed cooldown in syncSessions. 2) Fix stale callback guard. 3) Investigate lease renewal on production (log `renewAllLeases` results). 4) FxSocket terminal pod issue — contact FxSocket support if persists.

### 2026-07-28 — GramJS _updateLoop reconnect storm causes session invalidation (NOT AUTH_KEY_UNREGISTERED) — fixed by monkeypatching _sender.reconnect

- **Context:** After rollback + 11 hardening fixes, user's session kept getting invalidated. Two deaths:
  - **First death (AUTH_KEY_UNREGISTERED):** Telegram revoked the auth key during the `af12737d` storm. Session properly invalidated.
  - **Second death (GramJS storm):** After re-linking, the new session worked briefly but then GramJS's `_updateLoop` (`telegram/client/updates.js:212`) started an infinite reconnect storm. This caused `BinaryReader.readUInt32LE` crashes (malformed RPC results), which triggered `noteMalformedRpcResult` exhaustion, which incorrectly called `onAuthKeyDuplicatedRecoveryExhausted` — invalidating a perfectly valid session.
- **Root cause of second death:** GramJS's `_updateLoop` has its own independent reconnect trigger that bypasses `autoReconnect: false`. When the PingDelayDisconnect ping fails, `updates.js:212` calls `client._sender.reconnect()` directly — MTProtoSender's `reconnect()` method at line 808 has NO check against `autoReconnect`. This creates an infinite loop: ping fails → reconnect → `_handleReconnect` → new `_updateLoop` → ping fails → reconnect → ...
- **Fix:** Monkeypatched `client._sender.reconnect` in `telegramClient.ts:buildClient` to respect `autoReconnect`. After `client.connect()`, wraps `_sender.reconnect` to be a no-op when `autoReconnect: false`. Our `forceReconnect` handles reconnection properly via explicit `client.connect()` calls.
- **Files:** `worker/src/telegramClient.ts` (buildClient — reconnect monkeypatch)
- **Reverted:** AUTH_KEY_UNREGISTERED invalidation changes in watchdog/poll/forceReconnect (they were targeting wrong problem)
- **Verification:** `npm run build` passes, all worker tests pass.

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
