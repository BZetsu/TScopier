# Stripe subscription setup

This document covers TScopier Stripe billing, webhook sync, and paywall enforcement.

## Products and prices

Configure in the Stripe Dashboard (or via CLI) and store price IDs as Supabase Edge Function secrets:

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `STRIPE_BASIC_PRICE_ID` | Basic monthly |
| `STRIPE_BASIC_ANNUAL_PRICE_ID` | Basic annual |
| `STRIPE_ADVANCED_PRICE_ID` | Advanced monthly |
| `STRIPE_ADVANCED_ANNUAL_PRICE_ID` | Advanced annual |
| `STRIPE_EXTRA_ACCOUNT_PRICE_ID` | Extra broker account (Advanced) monthly |
| `STRIPE_EXTRA_ACCOUNT_ANNUAL_PRICE_ID` | Extra broker account annual |
| `NOWPAYMENTS_API_KEY` | NOWPayments API key (crypto invoices) |
| `NOWPAYMENTS_IPN_SECRET` | NOWPayments IPN HMAC secret |
| `NOWPAYMENTS_IPN_URL` | Optional override; default `{SUPABASE_URL}/functions/v1/nowpayments-webhook` |

## Webhook

**URL:** `https://sso.tscopier.ai/functions/v1/stripe-webhook`

**Events** (enable all of these on the Stripe webhook endpoint):

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.finalized`
- `invoice.payment_failed`
- `invoice.payment_action_required`

`stripe-webhook` has `verify_jwt = false` in `supabase/config.toml` (Stripe uses signature verification instead).

On subscription updates, plan and `extra_accounts` are derived from Stripe line items (price IDs) and subscription metadata (`supabase_user_id`, `plan`, `extra_accounts`).

## Database

Table `subscriptions` (one row per user via `UNIQUE (user_id)`):

- `plan`: `basic` | `advanced`
- `status`: `active` | `trialing` | `canceled` | `past_due` | `incomplete`
- `extra_accounts`: Advanced add-on quantity
- `stripe_customer_id`, `stripe_subscription_id`, period/trial dates

Webhook sync **reconciles all Stripe subscriptions on the customer** and stores the best
entitlement (Advanced beats Basic; higher `extra_accounts` wins). This prevents a second
Basic checkout from overwriting an active Advanced row.

Ops: `POST /functions/v1/reconcile-stripe-entitlement` with
`{ "user_id": "..." }` (service role / admin / `WORKER_INTERNAL_TOKEN`) to force a resync.

Idempotency table: `stripe_events`.

Apply migrations including `20260527120000_subscriptions_user_id_unique.sql` before relying on webhook upserts.

### Admin access (`user_profiles`)

Migration `20260527140000_user_profiles_admin_subscription_status.sql` adds:

- `is_admin` (boolean, default `false`) — full app access without Stripe subscription
- `subscription_status` (text, nullable) — mirror of `subscriptions.status`, synced by trigger

Migration `20260605140000_user_profiles_admin_until.sql` adds:

- `admin_until` (timestamptz, nullable) — when set with `is_admin = true`, admin bypass expires at this time; `NULL` means permanent admin
- pg_cron job `expire-timed-admin-access` (every 5 minutes) sets `is_admin = false` when `admin_until` has passed

Users cannot self-promote to admin; a DB trigger resets `is_admin`, `admin_until`, and `subscription_status` on client updates. Set admin only via SQL Editor, service role, or backoffice `set_admin_access`:

```sql
-- Permanent admin
UPDATE public.user_profiles
SET is_admin = true, admin_until = NULL
WHERE user_id = '<uuid>';

-- Timed admin (expires automatically)
UPDATE public.user_profiles
SET is_admin = true, admin_until = '2026-07-01T00:00:00Z'
WHERE user_id = '<uuid>';
```

When timed admin expires, the user returns to **Free** plan behavior (paywall / subscription limits). Paid Stripe subscriptions are **not** canceled.

Admin bypass applies in the UI (`SubscriptionContext`), edge functions (`subscriptionAccess.ts`), and the trade worker.

Optional env on edge functions / worker: `TSCOPIER_ADMIN_USER_IDS` (comma-separated user UUIDs) for admin bypass without a DB row.

After changing `subscriptionAccess.ts`, redeploy affected edge functions (at minimum `backtest-run`):

```bash
supabase functions deploy backtest-run
```

## Customer portal

Edge function: `customer-portal` (JWT required).

Enable in Stripe Dashboard: plan changes, cancellation, payment method updates. Portal return URL defaults to `/billing`.

## Checkout flow

1. Choose plan on Billing / app `/pricing` / marketing `/pricing` → in-app **Card vs Crypto** step (optional promo code).
2. **Card:** `create-subscription-elements` creates an incomplete Stripe Subscription; client confirms with **Payment Element** (`@stripe/react-stripe-js`). Requires `VITE_STRIPE_PUBLISHABLE_KEY`. Entitlement sync via `confirm-checkout` + `stripe-webhook`.
3. **Crypto (NOWPayments):** `create-crypto-invoice` creates a USD-priced hosted invoice (amount from Stripe membership price IDs). Customer pays USDC/other crypto on NOWPayments. IPN → `nowpayments-webhook` grants one period on `subscriptions` (`stripe_subscription_id` null; manual renew). Success URL: `/dashboard?checkout=success&crypto_invoice={order_id}`. Secrets: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` (optional `NOWPAYMENTS_IPN_URL`). Point dashboard IPN to `https://<project-ref>.supabase.co/functions/v1/nowpayments-webhook`.
4. Card metadata / Elements still use Stripe `supabase_user_id`, `plan`, `interval`, `extra_accounts`.
5. **Advanced first-time free trial** — 5 days when no prior `trial_ends_at` (Elements SetupIntent). Basic is charged from day one. Crypto has no trial (pay for period).
6. Success: `/dashboard?checkout=success` (card may include `session_id`; crypto includes `crypto_invoice`). Cancel → `/billing`.
7. **Payment methods tab** (`/billing?tab=payment_methods`): `create-setup-intent` opens **Stripe Checkout in `setup` mode** (hosted add-card page, same as Copygram — Card + wallets when eligible); `list-payment-methods` / `detach-payment-method` manage saved cards. Customer Portal remains for cancel / rare Stripe tasks.
8. **Stripe crypto Checkout is retired** (`create-checkout-session` returns 410). Use NOWPayments for crypto.

### Checkout troubleshooting

**Elements (card):** missing `VITE_STRIPE_PUBLISHABLE_KEY`, ad blockers blocking Stripe.js, or invalid promo codes (`invalid_promotion_code`).

**NOWPayments crypto:** missing `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET`, IPN URL not reachable, or signature mismatch (`x-nowpayments-sig`). Check `crypto_invoices` row status and edge logs.

## Paywall (plan limits)

| Feature | Basic | Advanced |
|---------|-------|----------|
| Broker accounts | 1 | 5 + extra (max 100 total) |
| Telegram channels | 5 | Unlimited |
| Backtests / month | 5 | Unlimited |
| TP distribution rows | 3 | Unlimited |
| Multi/range trading, auto BE, RR modes, keyword filters | Blocked | Allowed |

**UI:** `FeatureGate`, `UpgradePrompt`, dashboard banner when no active plan or past due.

**Server:** `broker-metatrader` register, `backtest-run`, worker `handleSignal` (subscription + advanced manual settings).

`past_due` is treated as inactive for feature gates; billing page links to Customer Portal.

When Stripe finalizes an open invoice billed via `send_invoice` (`invoice.finalized`), the webhook emails an **Invoice Due** notice with a link to the hosted invoice (or `/billing` as fallback). Auto-charged (`charge_automatically`) renewals are skipped so card subscribers are not emailed every cycle.

When Stripe needs 3DS or another customer step (`invoice.payment_action_required`), or a charge fails (`invoice.payment_failed`), the webhook sets `past_due`, pauses the copier, and emails the user a link to the hosted invoice (or `/billing` as fallback).

After payment, the app also calls `confirm-checkout` (using Stripe `session_id` from the success URL) so entitlement syncs even when the webhook is delayed or not configured for a given Supabase project (e.g. local/staging).

## Manual smoke test checklist

1. **New user (unpaid)** — after verify, redirected to `/pricing`; dashboard and other app routes blocked until paid.
2. **Basic checkout** — complete test checkout (charged day one); `subscriptions` row `plan=basic`, `status=active`.
3. **Second broker on Basic** — UI + `broker-metatrader` register return limit error.
4. **Advanced checkout** — first-time Advanced subscribers get a 5-day free trial; extra accounts editor on `/billing` works; limits expand.
5. **Trial used / Basic** — Advanced after a prior trial and Basic checkout charge from day one; existing `trialing` users keep access until trial ends.
6. **Portal cancel** — webhook sets `status=canceled`; Advanced settings blocked again.
7. **Backtest limit** — sixth run in UTC month on Basic rejected by `backtest-run`.

### Stripe test card

Use `4242 4242 4242 4242`, any future expiry, any CVC, any billing postal code.

## Deploy

```bash
supabase db push
supabase functions deploy stripe-webhook create-checkout-session create-subscription-elements create-setup-intent list-payment-methods detach-payment-method confirm-checkout customer-portal update-extra-accounts
supabase functions deploy backtest-run broker-metatrader
# Redeploy worker for subscription execution gates
```

## Expected row after checkout

```json
{
  "user_id": "<uuid>",
  "plan": "basic",
  "status": "active",
  "extra_accounts": 0,
  "stripe_customer_id": "cus_...",
  "stripe_subscription_id": "sub_..."
}
```
