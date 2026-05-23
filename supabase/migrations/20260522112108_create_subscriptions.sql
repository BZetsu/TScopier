/*
  # Create subscriptions and Stripe event tracking tables

  1. New Tables
    - `subscriptions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `stripe_customer_id` (text)
      - `stripe_subscription_id` (text, unique)
      - `plan` (text, one of: basic, advanced)
      - `status` (text, one of: active, trialing, canceled, past_due, incomplete)
      - `extra_accounts` (integer, default 0, additional accounts beyond 5 for advanced plan)
      - `trial_ends_at` (timestamptz, nullable)
      - `current_period_end` (timestamptz, nullable)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `stripe_events`
      - `event_id` (text, primary key, Stripe event ID for idempotency)
      - `event_type` (text)
      - `processed_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Users can SELECT their own subscription row
    - Only service role can INSERT/UPDATE (via edge function webhooks)
    - stripe_events is service-role only (no user access)

  3. Indexes
    - Index on subscriptions.user_id for fast lookup
    - Index on subscriptions.stripe_customer_id for webhook matching
*/

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text UNIQUE,
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'advanced')),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('active', 'trialing', 'canceled', 'past_due', 'incomplete')),
  extra_accounts integer NOT NULL DEFAULT 0,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);

-- Stripe events table for idempotent webhook processing
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- No user-facing policies for stripe_events - service role only
