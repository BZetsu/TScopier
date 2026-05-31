/*
  # Affiliate program foundation

  Adds:
  - affiliate_profiles
  - referral_attributions
  - commission_ledger
  - payout_batches
  - onboarding/referral helper columns on user_profiles
*/

-- Helpful enums for affiliate lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'affiliate_attribution_source') THEN
    CREATE TYPE affiliate_attribution_source AS ENUM ('signup_url', 'signup_form', 'onboarding', 'admin');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'affiliate_commission_status') THEN
    CREATE TYPE affiliate_commission_status AS ENUM ('pending', 'approved', 'paid', 'reversed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'affiliate_payout_status') THEN
    CREATE TYPE affiliate_payout_status AS ENUM ('draft', 'processing', 'paid', 'cancelled');
  END IF;
END
$$;

-- Keep profile-level onboarding/referral state for app routing.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_profiles.onboarding_completed_at IS
  'Timestamp when the user completed the welcome onboarding flow.';

COMMENT ON COLUMN public.user_profiles.referred_by_user_id IS
  'Referral owner linked to this user (first valid referral wins).';

-- Existing users are considered onboarded.
UPDATE public.user_profiles
SET onboarding_completed_at = COALESCE(onboarding_completed_at, now());

CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  payout_email text,
  stripe_connect_account_id text,
  total_earned_cents bigint NOT NULL DEFAULT 0,
  total_paid_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_profiles_referral_code_len CHECK (char_length(referral_code) BETWEEN 4 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_profiles_referral_code_lower
  ON public.affiliate_profiles (lower(referral_code));

CREATE TABLE IF NOT EXISTS public.referral_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  affiliate_user_id uuid NOT NULL REFERENCES public.affiliate_profiles(user_id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  attribution_source affiliate_attribution_source NOT NULL DEFAULT 'signup_url',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_attributions_not_self CHECK (referred_user_id <> affiliate_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_affiliate_user_id
  ON public.referral_attributions (affiliate_user_id);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referred_user_id
  ON public.referral_attributions (referred_user_id);

CREATE TABLE IF NOT EXISTS public.payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label text NOT NULL,
  total_cents bigint NOT NULL DEFAULT 0,
  status affiliate_payout_status NOT NULL DEFAULT 'draft',
  paid_at timestamptz,
  notes text,
  created_by_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL REFERENCES public.affiliate_profiles(user_id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  invoice_amount_cents bigint NOT NULL,
  commission_rate numeric(6, 4) NOT NULL DEFAULT 0.1000,
  commission_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status affiliate_commission_status NOT NULL DEFAULT 'pending',
  payout_batch_id uuid REFERENCES public.payout_batches(id) ON DELETE SET NULL,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_affiliate_user_id
  ON public.commission_ledger (affiliate_user_id);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_referred_user_id
  ON public.commission_ledger (referred_user_id);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_status
  ON public.commission_ledger (status);

ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own affiliate profile" ON public.affiliate_profiles;
CREATE POLICY "Users can view own affiliate profile"
  ON public.affiliate_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own affiliate profile" ON public.affiliate_profiles;
CREATE POLICY "Users can update own affiliate profile"
  ON public.affiliate_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own attribution as referrer" ON public.referral_attributions;
CREATE POLICY "Users can view own attribution as referrer"
  ON public.referral_attributions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = affiliate_user_id);

DROP POLICY IF EXISTS "Users can view own attribution as referee" ON public.referral_attributions;
CREATE POLICY "Users can view own attribution as referee"
  ON public.referral_attributions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referred_user_id);

DROP POLICY IF EXISTS "Users can view own commission ledger" ON public.commission_ledger;
CREATE POLICY "Users can view own commission ledger"
  ON public.commission_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = affiliate_user_id);

CREATE OR REPLACE FUNCTION public.touch_affiliate_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_profiles_touch_updated_at ON public.affiliate_profiles;
CREATE TRIGGER affiliate_profiles_touch_updated_at
  BEFORE UPDATE ON public.affiliate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_affiliate_updated_at();

DROP TRIGGER IF EXISTS payout_batches_touch_updated_at ON public.payout_batches;
CREATE TRIGGER payout_batches_touch_updated_at
  BEFORE UPDATE ON public.payout_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_affiliate_updated_at();

