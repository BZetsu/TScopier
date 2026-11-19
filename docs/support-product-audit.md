# Support knowledge audit — what actually exists in the app

**Date:** 2026-11-17
**Purpose:** a verified inventory of the product's real screens, labels and flows, used to
write `supabase/functions/_shared/supportProductMap.ts` — the only source of UI truth the
support AI is allowed to use.

**Why:** the support AI told a customer to "browse available channels and select the ones
you want to follow". No such screen exists. A gap in the knowledge gets filled with a
plausible invention, so the fix is coverage, not wording.

**How each claim was checked:**

| Claim type | Verified against |
|---|---|
| Routes | `src/App.tsx` (`<Route path=…>`) |
| Sidebar names | `src/i18n/locales/en.ts` → `nav.items`, `pages.*` |
| Page capabilities | the page component in `src/pages/dashboard/` |
| Broker configuration tabs | `src/i18n/locales/configureModal/en.ts` → `manualSubTabs` |
| Signal-source tabs and labels | `src/i18n/locales/en.ts` → `channelsPage` |
| Settings sections | `src/i18n/locales/en.ts` → `settings.sections` |

---

## 1. Navigation, as it appears today

Sidebar grouped by section, with the exact labels:

| Section | Item | Route |
|---|---|---|
| — | Dashboard | `/dashboard` |
| GENERAL | **Account Configuration** | `/brokers` |
| GENERAL | Account Trades | `/account-trades` |
| GENERAL | Manage Trades | `/manage-signals` |
| GENERAL | Copier Process | `/activities` |
| GENERAL | Copier Logs | `/copier-logs` |
| GENERAL | Reported Trades | `/reported-trades` |
| COPY | Mirror Accounts | `/mirror-trading` |
| COPY | Social Trading | `/social-trading` (hidden when the feature flag is off) |
| COPY | **Signals** | `/channels` |
| COPY | Backtest | `/backtest` |
| COPY | Performance | `/performance` |
| TRADING TOOLS | Market News | `/market-news` |
| TRADING TOOLS | Economic Calendar | `/economic-calendar` |
| MEMBERSHIP | Billing | `/billing` |
| MEMBERSHIP | Affiliate Program | `/affiliate-program` |

Plus, not in the sidebar: Settings `/settings`, Contact Support `/contact-support`,
Feature Request `/feature-request`, Partner with us `/partner-with-us`, Wallet `/wallet`,
Portfolio `/portfolio`, Analysis Hub `/analysis-hub`, Updates `/updates`.

**Header control:** a **Pause Copier** button, which pauses copying for every account at
once. Per-account start/stop is in Account Configuration.

## 2. What does not exist (the traps)

- **No channel directory.** You cannot browse, search, buy or subscribe to channels inside
  the app. "Popular Channels" was removed; `/popular-channels` redirects to the Dashboard.
  Only channels the customer's own linked Telegram account can already see can be added.
- **No "Brokers" page.** The account list is called **Account Configuration**; `/brokers` is
  only the address. `/account-configuration` redirects there.
- **No "Channels" page name.** `/channels` is titled **Signals**; `/copier-engine` redirects
  to it.
- **No "Configurations" page** in the navigation — hidden.
- **No "Trades" page name.** `/account-trades` is **Account Trades**; `/trades` redirects.
- **No "Trades settings" / "Copy Settings" / "Risk Management" screen.** Risk and lot live in
  the per-account configuration window.
- **No pips setting.** Take-profit levels are set per channel under Targets; size is set
  under Risk.

## 3. Account Configuration (`/brokers`)

The page title and description: "Account Configuration — Connect MetaTrader accounts and
tune how each one copies signals."

- **Add account** → "Add a trading account" → pick a platform tile
  (`src/components/broker/AddAccountPlatformModal.tsx`):
  - **Connectable today: MT5, MT4, cTrader.** MT4/MT5 ask for an optional label, account
    login, broker server and password; cTrader uses "Continue with cTrader", sign in, then
    pick the demo or live account.
  - **Coming soon (tile disabled, no `platform` set in the code):** Binance USD-M, Bybit
    Linear, KuCoin Futures, DX-Trade, TradeLocker, MatchTrader, Tradovate. The connect forms
    and i18n copy exist, but the entry point is not released to customers.
- **Reconnect** and **Reconnect all** exist for a dropped broker session.
- Each account opens a **configuration window** with these tabs:
  **Symbols, Instructions, Risk, Targets, Management, Filters, Signal Examples**.
  - **Symbols** — symbol mapping, prefix/suffix, exclusions.
  - **Instructions** — how this channel writes and updates signals (AI training examples).
  - **Risk** — Risk Mode, Fixed Lot, and "Calculate risk / lot size" (fixed lot or a target
    risk as a percentage of balance, showing risk if the stop-loss is hit).
  - **Targets** — take-profit levels.
  - **Management** — breakeven, trailing, partial close behaviour.
  - **Filters** — which signals are copied.
- **Presets** can be saved from a configured channel and applied to another.
- Multi-trade and range/layering settings live in the same window.

## 4. Signals (`/channels`)

Subtitle: "Manage which Telegram channels you're monitoring".

- **Signal sources** panel with a **Connect** action per platform. **Telegram, WhatsApp and
  TradingView are always selectable**; **Discord** is locked ("Coming soon") when the build
  switch `VITE_ENABLE_EXTRA_SOURCES` is false (`src/lib/featureFlags.ts`, `LOCKED_WHILE_OFF`).
- Telegram: phone number → **Send Code** → code. After linking, the channels the account
  belongs to are listed and can be added.
- **Add channel** (manual form: channel name, optional username, optional channel ID).
- **Per-channel overrides**: lot size override, pip tolerance override, or "Use broker
  default"; channels can be paused.
- TradingView: **Create webhook**, giving a Webhook URL and an alert message template, with
  "How to Add to TradingView" steps. Alerts without stop-loss or take-profit prices are
  refused unless the Override options are used.

## 5. Other surfaces

| Surface | What it is |
|---|---|
| Account Trades (`/account-trades`) | Open and closed broker positions with tickets and PnL; refreshes every 60 seconds |
| Manage Trades (`/manage-signals`) | Signal history: entries, closes and SL/TP updates from connected channels |
| Copier Process (`/activities`) | Management/automation view; not the Telegram page |
| Copier Logs (`/copier-logs`) | Per-signal pipeline: parsed → dispatched → executed, skipped (with reason) or failed (with error) |
| Reported Trades (`/reported-trades`) | Trades the customer reported, with status |
| Mirror Accounts (`/mirror-trading`) | Copy from a master account to slave accounts |
| Social Trading (`/social-trading`) | Browse traders by ROI, win rate, followers, copiers, rating |
| Backtest (`/backtest`) | Replay a channel's signals against historical data; Basic has a monthly quota, Advanced unlimited |
| Performance (`/performance`) | Win rate, profitability analytics |
| Portfolio (`/portfolio`) | Overall portfolio across accounts |
| Analysis Hub (`/analysis-hub`) | Charting and analysis tools |
| Market News, Economic Calendar | News feed and event calendar with high-impact markers |
| Billing (`/billing`) | Plan, invoices, **Manage billing** (Stripe portal: payment method, cancellation) |
| Wallet (`/wallet`) | Copy-subscription balance and payment history |
| Affiliate Program (`/affiliate-program`) | 10% lifetime commission on paid subscriptions |
| Settings (`/settings`) | Personal information (name, photo), General settings (defaults for balances, reports, timestamps), Security (password). Email cannot be changed here |
| Contact Support (`/contact-support`) | The in-app support widget with the AI and the human option |

## 6. What the support AI must never do

1. Name a screen, tab or button that is not in this audit.
2. Describe a catalogue, directory, marketplace, or "browse channels" flow.
3. Say "it may be labelled differently".
4. Repeat a failed instruction — ask for a screenshot instead, then escalate after two
   failed attempts.
5. Claim to see the customer's screen unless they shared an image.
