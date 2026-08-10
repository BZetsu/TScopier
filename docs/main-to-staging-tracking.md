# Main → Staging Sync Tracker

This document is the permanent record of every change pulled from `upstream/main` (production) into `upstream/staging`. It exists so that if a change causes issues on staging — or during the next staging → main promotion — we can trace exactly what came in, when, and what it touched.

## How to use this file

- **Before** pulling main → staging, append a new dated entry at the top of the table in section 2 with the commits being pulled.
- **After** any main → staging merge, update section 3 (merge log) with the merge commit hash.
- **If an issue appears on staging**, search this file for the affected file/feature to find which main-originated commit introduced it.
- Every entry must list: date pulled, merge commit, the exact main commits included, and per-commit file impact.

---

## 1. The current state

- **staging tip before this sync:** `8fed9f19` (`Merge pull request #86 from tartarixinc/off-staging-ai-assistant`, 2026-08-08 22:25 +0100)
- **main tip used for this sync:** `cff88c39` (`Merge pull request #90 from tartarixinc/off-staging-ai-assistant`, 2026-08-08 23:49 +0100)
- **Result:** `upstream/staging` and `upstream/main` now contain the **same code tree** (verified: `git diff` between merged tree and `upstream/main` = 0 lines). Staging was already a full ancestor of main, so the merge was a clean fast-forward-style no-conflict merge.
- **Conflict status:** none — 0 conflicted files, automatic merge completed cleanly.

---

## 2. Changes pulled from main into staging

### Sync #1 — 2026-08-08 (performed locally, pending push)

**Merged branch:** `merge/main-to-staging` (created from `upstream/staging`, merged `upstream/main` into it).
**Includes all 22 commits that existed on main but not staging.** Breakdown:

| # | Commit | Date | Author | What it changed | Files touched |
|---|--------|------|--------|----------------|---------------|
| 1 | `4971bfe7` | 2026-08-06 | Osodi | Multilingual signal-term handling + entry-price extraction | `supabase/functions/_shared/multilingualSignalTerms.ts`, `supabase/functions/parse-signal/index.ts`, `worker/src/multilingualSignalTerms.ts`, `worker/src/parseSignal.ts`, `worker/src/parseSignal.test.ts` |
| 2 | `a75e94e8` | 2026-08-06 | Osodi | Refactored `collapseIdenticalImmediateLegs` + updated its tests/imports | `worker/src/tradeExecutor/collapseIdenticalImmediateLegs.ts`, `collapseIdenticalLegs.test.ts`, `orderLegExecution.ts`, `singleStyleHardBlock.test.ts` |
| 3 | `a35d0f8f` | 2026-08-06 | Osodi | **Email unsubscribe** feature: new public unsubscribe page, edge function, config | `public/unsubscribe.html`, `src/App.tsx`, `src/pages/auth/EmailUnsubscribePage.tsx`, `supabase/config.toml`, `supabase/functions/email-unsubscribe/index.ts`, `_shared/subscriptionCampaignEmails.ts`, `send-subscription-campaigns/index.ts`, `send-subscription-email/index.ts` |
| 4 | `26f88d44` | 2026-08-06 | Osodi | **Backtest history modal + CSV export** | `src/components/backtest/BacktestHistoryModal.tsx`, `src/lib/backtestCsv.ts` (new), `backtestDisplay.ts`, `backtestPipDisplay.test.ts` (new), `src/pages/dashboard/Backtest.tsx`, 11 i18n locale files, `supabase/functions/_shared/backtest/tpslSummary.ts` |
| 5 | `d8a09c69` | 2026-08-06 | Osodi | Listener-lease-status handling + broker connection status updates | `src/lib/listenerLeaseStatus.ts`, `supabase/functions/fxsocket-broker/index.ts`, `worker/src/brokerConnectionStatus.ts`, `worker/src/tradeExecutor/brokerSymbolCache.ts` |
| 6 | `c4bd664b` | 2026-08-07 | Osodi | Better error handling in `updateLayeringSettings` | `src/lib/updateLayeringSettings.ts` |
| 7 | `05b69db7` | 2026-08-07 | Osodi | Broker-symbol resolution + error handling in backtest functions | `deno.lock`, `supabase/functions/_shared/backtest/fxsocketMarketData.ts` + test, `resolveBacktestBroker.ts` + test |
| 8 | `31a47da1` | 2026-08-07 | Osodi | Platform handling in backtest functions | `supabase/functions/_shared/backtest/marketData.ts`, `resolveBacktestBroker.ts` + test, `tradeReplayData.ts` |
| 9 | `5386750e` | 2026-08-07 | Osodi | **Dead-broker Reconnect fix** — re-links FxSocket with password | `src/context/BrokerAccountsContext.tsx`, `src/hooks/useBrokerReconnect.ts` (new), `src/lib/brokerReconnect.ts` + test, `src/lib/fxsocketBroker.ts`, `supabase/functions/fxsocket-broker/index.ts`, `worker/src/brokerConnectionStatus.ts` |
| 10 | `a895585c` | 2026-08-07 | Osodi | **Stop treating FxSocket rate limits as broker disconnects** | `src/components/broker/BrokerTerminalHealthSync.tsx`, `src/hooks/usePerformanceData.ts`, `src/pages/dashboard/AccountConfigPage.tsx`, `DashboardPage.tsx`, `supabase/functions/_shared/brokerConnectError.ts`, `fxsocket-broker/index.ts` |
| 11 | `b13a3db5` | 2026-08-07 | Osodi | **Removed proactive FxSocket `keepSessionAlive` pings** | `worker/.env.example`, `worker/src/fxsocketClient.ts`, `worker/src/tradeExecutor/brokerSymbolCache.ts` + test, `worker/src/workerConfig.ts` |
| 12 | `9e354c57` | 2026-08-07 | Osodi | **Fix null `user_id` inserts** on channel configs + trade logs | `supabase/migrations/20260807120000_fill_user_id_on_broker_channel_and_trade_logs.sql` (new), `worker/src/channelTradingConfig.ts`, `worker/src/orderCloseAudit.ts`, `worker/src/tradeExecutor/TradeExecutor.ts`, `signalBrokerDispatchClaim.ts` + test |
| 13 | `1538ecb4` | 2026-08-08 | Osodi | Merge of `origin/staging` into `main` (bridge commit) | — (merge) |
| 14 | `21f71d4c` | 2026-08-08 | Osodi | "kk" (intermediate commit within assistant PR #87) | — (see PR #87 files) |
| 15 | `caa015b5` | 2026-08-08 | Tartarix | **Merge PR #87** — assistant refactor (variable names + error handling in `AssistantPanel`) | `src/components/assistant/AssistantPanel.tsx` |
| 16 | `dfe5dddd` | 2026-08-08 | Osodi | Refactor assistant: variable names + error handling in `AssistantPanel` | `src/components/assistant/AssistantPanel.tsx` |
| 17 | `1110c6ce` | 2026-08-08 | Osodi | "ok" (intermediate commit within assistant PR #88) | — (see PR #88 files) |
| 18 | `434d6cff` | 2026-08-08 | Tartarix | **Merge PR #88** — assistant improvements | `src/components/assistant/AssistantPanel.tsx` |
| 19 | `9dc9a36a` | 2026-08-08 | Osodi | **Pricing page** — wrap `AppPricingPage` content in flex container | `src/pages/pricing/AppPricingPage.tsx` |
| 20 | `a902adc9` | 2026-08-08 | Tartarix | **Merge PR #89** — pricing layout | `src/pages/pricing/AppPricingPage.tsx` |
| 21 | `d70ce906` | 2026-08-08 | Osodi | **Pricing page** — header with brand logo for navigation | `src/pages/pricing/AppPricingPage.tsx` |
| 22 | `cff88c39` | 2026-08-08 | Tartarix | **Merge PR #90** — pricing header (final main tip) | `src/pages/pricing/AppPricingPage.tsx` |

### Net change to the codebase (vs previous staging tip)

71 files changed, **+2,077 / −485 lines**. Major areas:
- Frontend: email unsubscribe page + public HTML, backtest history modal + CSV export, broker Reconnect flow, rate-limit handling, pricing page layout/header, assistant panel refactors.
- Edge functions: `email-unsubscribe` (new), `fxsocket-broker` (reconnect + rate-limit handling), `parse-signal`, backtest shared libs.
- Worker: reconnect password re-linking, removed keepalive pings, null user_id fixes, `collapseIdenticalImmediateLegs`, broker symbol cache refactor.
- Database: new migration `20260807120000_fill_user_id_on_broker_channel_and_trade_logs.sql` (fills `user_id` on `broker_channel` + `trade_logs`).

---

## 3. Merge log (append at top)

| Date | Merge commit | From | To | Conflicts? |
|------|-------------|------|----|-----------|
| (pending push) | `merge/main-to-staging` branch, merge of `cff88c39` | upstream/main | upstream/staging | None |

---

## 4. Promotions back out of staging

When staging is later promoted to main, any divergence created here must be reviewed. Because this sync made staging's tree identical to main's tree, the next staging → main promotion should be a no-op (or trivial) for these changes.
