# Project Memory - Martins

Changelog entries authored / owned by Martins, kept separate from the main `PROJECT_MEMORY.md` and Emma’s file by request.

## Changelog

### 2026-08-12 — Verification email resend cooldown

- 60s cooldown + 5/hour per email (server claim + verify UI countdown).

### 2026-08-12 — Block app access until email verification click

- Auto-confirm (Confirm email off) was syncing into `email_verified_at` → login bypassed verification.
- Hardened DB sync (2s rule) + staging cleanup; enable Confirm email in Supabase dashboard still required.
- Scratchpad: `docs/scratchpad-email-verification-bypass-2026-08-12.md`.

### 2026-08-11 — Signup-first + Welcome Modal restored

- “Get started for free” → `/signup`; post-verify Welcome Modal for plan/trial choice.
- Pending-plan checkout path unchanged (no welcome interrupt).
- Restored `WelcomeModal`, `useNeedsWelcome`, `auth.welcome` locales, `AppShell` wiring.

### 2026-08-11 — Pricing CTAs: Advanced trial button + Get started for free

- Advanced pricing CTA: “Start your 3-day free trial” (`pricing.startTrial`); Basic remains “Subscribe”.
- Marketing / paywall choose-plan wording → “Get started for free”.
- Wired in `PricingPlansSection.tsx` + `getSubscribeCtaLabel`.

### 2026-08-11 — Restore Advanced 3-day free trial

- **Product change:** Advanced first-time checkouts again get a **3-day free trial** (`trial_period_days: 3` when `!existingSub?.trial_ends_at`). Basic remains charged from day one. Money-back marketing copy is replaced by trial messaging.
- **Checkout:** `supabase/functions/create-checkout-session/index.ts` — restore Advanced trial block + keep `payment_method_collection: always`.
- **Copy/docs:** pricing + landing locales, campaign emails, `docs/stripe-setup.md`, `docs/marketing-site.md`.
- **Do not break these invariants:** (1) Only Advanced first-time subscribers get a free trial. (2) Users with a prior `trial_ends_at` do not get a second trial. (3) Basic never invents a free trial. (4) Live `trialing` rows keep access until `trial_ends_at`. (5) `confirm-checkout` + webhook must agree on plan/`extra_accounts`. (6) Basic cannot silently overwrite Advanced via a second checkout (reconcile best entitlement). (7) `past_due` remains inactive for feature gates; portal is the recovery path.
- **Follow-up:** Redeploy `create-checkout-session`; smoke Advanced trial vs Basic day-one charge.

### 2026-08-10 — XM gold OrderSend failures: friendly errors + metal symbol auto-resolve + mapping preserved

- **Context (user investigation):** User `59cc8c42-2535-4af8-8940-c5ee0754318f` (Mehmet / XMGlobal-MT5 2 demo `168535699`) was failing every gold copy with skip/error `HTTP 500`. Live FxSocket repro proved `getQuote`/`OrderSend` for `XAUUSD` returned HTTP 500 `SymbolSelect failed`; the account’s real gold symbol is `GOLD#`. Copier logs showed `trade_symbol=XAUUSD` / `signal_symbol=XAUUSD`. Account Config has **whitelist/exclude only** — there is no Symbol mapping UI. DB showed `symbol_mapping: {}` on `broker_accounts.manual_settings`, channel JSON, and the authoritative `broker_channel_trading_configs` row.
- **Root causes:**
  1. **Opaque errors:** v2 `FxClient.http()` threw bare `HTTP ${status}` and discarded the FxSocket body (`SymbolSelect failed`). That string became `trade_execution_logs.error_message` and `signals.skip_reason`.
  2. **No XAUUSD → GOLD# auto-match:** `resolveBrokerSymbolFromInventory` only tried exact / prefix-suffix / substring matches. `GOLD#` does not contain `XAUUSD`, so resolution left the signal symbol unchanged.
  3. **Maps wiped as “legacy”:** `clearLegacySymbolDecorationIfPresent` treated any non-empty `symbol_mapping` as disposable decoration and cleared it on symbol-inventory ready — even intentional escape hatches like `XAUUSD → GOLD#`.
- **Friendly error path:**
  - NEW `worker/src/brokerTradeError.ts` — `formatFxHttpFailureMessage` / `humanizeOrderSendError` / envelope parsing. SymbolSelect (+ symbol from OrderSend body or URL) → stable `Symbol not found: XAUUSD`. Bare HTTP 5xx → actionable broker-rejected copy.
  - `worker/src/engine/fxClient.ts` — HTTP failures use the formatter instead of `HTTP 500`.
  - `worker/src/tradeExecutor/orderLegExecution.ts` — catch path + rejected-send path humanize before persisting skip/error.
  - `worker/src/observability/businessEvents.ts` — `SymbolSelect` / select-failed classify as `SYMBOL_UNSUPPORTED`.
  - Frontend `src/lib/channelWorkerLogMessage.ts` — translates `Symbol not found: …`, SymbolSelect, and historical bare `HTTP 500` (using payload symbol hint) into user copy. i18n `errorSymbolNotFound` / new `errorBrokerRejectedGeneric` across channelWorker locales.
- **Symbol resolution fix:**
  - `resolveMetalAliasFromInventory` in `brokerSymbolCache.ts` — maps canonical `XAUUSD` / `GOLD` onto broker metals (`GOLD#`, `GOLD`, `XAUUSD#`, `GOLD24-7#`, …) without picking equity lookalikes (`BarrickGold`, `GoldmSachs`, `Gold Fields`).
  - `brokerSymbolDecoration.ts` — legacy clear now only strips **prefix/suffix**; **preserves `symbol_mapping`**.
- **Ops fix for this user (prod):** Wrote `{"XAUUSD":"GOLD#","GOLD":"GOLD#"}` onto account `manual_settings`, channel JSON under `513ef0b5-…`, and `broker_channel_trading_configs.manual_settings` so channel overlay does not wipe the account map.
- **Verification:** worker tests for `brokerTradeError`, `fxClient` SymbolSelect message, `symbolMapping` metal aliases, `brokerSymbolDecoration` map-preserve; frontend `channelWorkerLogMessage` HTTP 500 / Symbol not found cases.
- **Affected files:** `worker/src/brokerTradeError.ts` (+ test), `worker/src/engine/fxClient.ts` (+ test), `worker/src/tradeExecutor/orderLegExecution.ts`, `worker/src/tradeExecutor/brokerSymbolCache.ts`, `worker/src/tradeExecutor/brokerSymbolDecoration.ts` (+ tests), `worker/src/tradeExecutor/symbolMapping.test.ts`, `worker/src/observability/businessEvents.ts`, `src/lib/channelWorkerLogMessage.ts` (+ test), `src/i18n/channelWorker/{en,es,fr,ar,ja,nl,pl,ru,sv,types}.ts`, `docs/PROJECT_MEMORY-MARTINS.md`.
- **Do not break these invariants:** (1) Never persist bare `HTTP 5xx` when FxSocket body has a message. (2) Never clear explicit `symbol_mapping` as legacy. (3) Metal alias must not map XAUUSD onto equity ticker names containing “Gold”. (4) Channel config overlay is authoritative for execution — maps must exist on `broker_channel_trading_configs`, not only account JSON. (5) Friendly UI copy must not claim a Symbol mapping UI that Account Config does not expose.
- **Follow-up:** Redeploy trade worker so metal auto-resolve + map-preserve + friendly errors are live; next gold signal for the XM user should OrderSend `GOLD#`.

### 2026-08-10 — Apex-style gold sell parsing + execution eligibility

- **Context:** Channel signals in the Apex / “Trade Activated From …” style (underscore zones, RRR commentary) were being under-parsed or blocked by eligibility.
- **Changes:** `worker/src/parseSignal.ts` — strip RRR noise; parse Apex-style activated gold sells with underscore entry zones; eligibility tests allow these structures while keeping non-trade commentary blocked. Tests in `parseSignal.test.ts` + `signalExecutionEligibility.test.ts`.
- **Commit:** `c366290f`.
- **Follow-up:** Watch live Apex channels for false positives on commentary-only messages.

### 2026-08-08 — In-app AI Assistant (`assistant-chat`)

- **Objective:** Ship a header chat assistant that explains TScopier and performs **user-scoped** actions via OpenAI tool-calling, without sending broker passwords or Telegram OTPs through the model.
- **Docs:** `docs/assistant-setup.md` (deploy, client behaviour, manual check list).
- **Edge function:** `supabase/functions/assistant-chat/index.ts` — JWT required (`verify_jwt = true`); secret `OPENAI_API_KEY`; optional `ASSISTANT_OPENAI_MODEL` (default `gpt-4o-mini`). Shared knowledge in `supabase/functions/_shared/assistantKnowledge.ts`.
- **Client:**
  - Header sparkles → `AssistantPanel` (`src/components/assistant/`); `AssistantProvider` / `AssistantContext` in AppShell.
  - Chat history in `sessionStorage` (last 20 turns per user); phone numbers redacted.
  - **Secure cards:** `AssistantTelegramLinkCard` (phone + OTP) and `AssistantBrokerConnectCard` (MT password) — secrets never go through OpenAI.
  - Image attachments supported in chat bubbles.
  - Mutations (pause/resume, channel config, apply/save preset) show a **Confirm** card, then `{ execute: { tool, args } }`.
- **Tools / behaviours (iterated over the weekend):**
  - Telegram link status + in-chat link flow.
  - Broker connect by MT login; resolve brokers by login (e.g. `928883`).
  - `update_channel_config` for lot / multi / range (Confirm → save); offer `save_preset`.
  - `open_broker_config` — UI-only navigation to `/brokers` + configure modal (asks which broker when several); must **not** claim settings changed.
  - `open_backtest` → `/backtest` with short steps; `list_backtests` summarizes recent runs. Runs still complete in the Backtest UI.
  - Manage / import / export presets (i18n across locales).
- **Auth hardening:** single-flight token refresh for edge 401s (`feat(auth): implement single-flight token refresh`).
- **Onboarding:** removed WelcomeModal + related translations (pricing gate owns first-run paywall UX).
- **PRs / merges:** `off-staging-ai-assistant` series (#86–#90) into staging/main over 2026-08-08.
- **Deploy:**

```bash
supabase functions deploy assistant-chat --project-ref <staging-or-prod-ref> --use-api
# Ensure OPENAI_API_KEY is set on Edge secrets
```

- **Manual checks (from assistant-setup.md):** Telegram linked?; link phone→OTP; connect MT5; configure broker by login + Confirm; open broker config page; open/list backtests; pause copier Confirm; screenshot attach.
- **Do not break these invariants:** (1) Passwords/OTP never enter OpenAI tool args or chat history. (2) `open_broker_config` / navigation tools must not claim durable settings writes. (3) Mutating tools require Confirm + authenticated execute. (4) Assistant is user-scoped JWT only — no service-role client actions from the browser panel.
- **Follow-up:** Keep `docs/assistant-setup.md` in sync when adding tools; re-run the manual checklist after each assistant-chat deploy.

### 2026-08-08 — Stripe / pricing flow: paid-from-day-one + confirm-checkout + marketing CTA

- **Docs:** `docs/stripe-setup.md`, `docs/marketing-site.md` updated for the new flow.
- **Product change (historical, 2026-08-08):** temporarily removed free trial on new checkouts in favor of paid-from-day-one + 30-day money-back messaging. **Superseded 2026-08-11** — Advanced first-time 3-day trial restored; money-back copy replaced.
- **Checkout path:** Marketing **Choose a plan** → `/pricing` → remember plan (`pendingPlanSelection`) → signup/login → `create-checkout-session` → Stripe Hosted Checkout → success `/dashboard?checkout=success`. Cancel → `/pricing`. Card always collected; webhook sets `save_default_payment_method: on_subscription`.
- **Entitlement sync:** NEW/expanded `confirm-checkout` edge function so entitlement applies even when webhook is delayed or missing on a project (local/staging). `SubscriptionContext` refreshes on `checkout=success`. Webhook still reconciles best entitlement (Advanced beats Basic; higher `extra_accounts` wins).
- **App paywall UX:** unpaid users redirected to `/pricing` after verify; dashboard routes gated; `AppPricingPage` layout/header polish (brand logo header). Marketing CTAs / PricingPlansSection / site URL helpers (`appUrl` / `marketingUrl`) clarified for localhost vs production.
- **Worker:** `planMultiManualOrders` refinements for empty `finalTps` scenarios (pricing-review branch companion work).
- **PRs:** `off-staging-pricing-review-etc` (#84–#85).
- **Stripe secrets / webhook (unchanged contract, docs refreshed):** `STRIPE_*_PRICE_ID`s, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook URL `https://sso.tscopier.ai/functions/v1/stripe-webhook`; events include `checkout.session.completed`, subscription updated/deleted, invoice paid/finalized/payment_failed/payment_action_required.
- **Deploy reminder:**

```bash
supabase functions deploy stripe-webhook create-checkout-session confirm-checkout customer-portal update-extra-accounts
supabase functions deploy backtest-run broker-metatrader
# Redeploy worker for subscription execution gates
```

- **Do not break these invariants (updated 2026-08-11):** (1) Only Advanced first-time subscribers get a free trial; Basic is paid day one. (2) Users with prior `trial_ends_at` get no second trial. (3) Live `trialing` rows keep access until trial end. (4) `confirm-checkout` + webhook must agree on plan/`extra_accounts`. (5) Basic cannot silently overwrite Advanced via a second checkout (reconcile best entitlement). (6) `past_due` remains inactive for feature gates; portal is the recovery path.
- **Smoke test:** unpaid → `/pricing`; Basic checkout → `subscriptions.plan=basic`; second broker blocked on Basic; Advanced + extras; portal cancel; Basic backtest month cap.

### 2026-08-08 — Config presets: manage / import / export (i18n)

- **Context:** Assistant and Account Config need durable preset save/load/export without English-only strings.
- **Changes:** i18n keys for manage presets, import, export, and export-selection across locales; wired through assistant + config UX.
- **Commits:** `995c15c1`, `220a4a7c`, `5397a8e9`.
- **Follow-up:** Confirm preset round-trip (save → apply → export → import) on staging in EN + one non-EN locale.

### 2026-08-10 — Basket modify merge failure flag cleanup

- **Context:** Clarify when basket leg modify-merge is treated as failed vs recoverable.
- **Commit:** `b5ecc85c` — `basketLegModifyMergeFailed` logic + tests.
- **Follow-up:** Keep management/modify paths failing closed when merge cannot safely attach.

## Pointers (weekend surface area)

| Area | Canonical doc / entrypoint |
|------|----------------------------|
| AI Assistant | `docs/assistant-setup.md`, `supabase/functions/assistant-chat/`, `src/components/assistant/` |
| Stripe / paywall | `docs/stripe-setup.md`, `create-checkout-session`, `confirm-checkout`, `stripe-webhook`, `SubscriptionContext` |
| Marketing pricing CTA | `docs/marketing-site.md`, `PricingPlansSection`, `pendingPlanSelection` |
| Broker symbol / gold | `worker/src/tradeExecutor/brokerSymbolCache.ts`, `brokerSymbolDecoration.ts`, `brokerTradeError.ts` |
| Signal parse (Apex gold) | `worker/src/parseSignal.ts`, `signalExecutionEligibility` |

## Open follow-ups

1. Deploy trade worker with metal alias + map-preserve + friendly OrderSend errors.
2. Confirm XM user next gold signal sends `GOLD#` (mapping already written in prod DB).
3. Keep assistant-setup checklist green after each `assistant-chat` deploy.
4. Stripe smoke test on staging whenever `create-checkout-session` / `confirm-checkout` change.
