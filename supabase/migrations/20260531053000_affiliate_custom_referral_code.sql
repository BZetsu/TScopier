/*
  # Affiliate custom referral code policy

  - Allow broader code formats with no whitespace
  - Enforce practical length bounds (3..32)
*/

ALTER TABLE public.affiliate_profiles
  DROP CONSTRAINT IF EXISTS affiliate_profiles_referral_code_len;

ALTER TABLE public.affiliate_profiles
  ADD CONSTRAINT affiliate_profiles_referral_code_len
  CHECK (
    char_length(referral_code) BETWEEN 3 AND 32
    AND referral_code !~ '\s'
  );

