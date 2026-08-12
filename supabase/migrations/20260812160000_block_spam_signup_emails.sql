/*
  Block obvious spam signups at auth.users INSERT time.
  Mirrors supabase/functions/_shared/emailSignupPolicy.ts so bots are rejected
  even when the before-user-created Auth Hook is not enabled in the dashboard.
*/

CREATE OR REPLACE FUNCTION public.block_spam_auth_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email text;
  local_part text;
  domain_part text;
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  normalized_email := lower(btrim(NEW.email));
  local_part := split_part(normalized_email, '@', 1);
  domain_part := split_part(normalized_email, '@', 2);

  IF local_part = '' OR domain_part = '' OR position(' ' in domain_part) > 0 THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = 'P0001';
  END IF;

  IF domain_part IN (
    'mailinator.com',
    'guerrillamail.com',
    'guerrillamail.net',
    'sharklasers.com',
    'grr.la',
    'tempmail.com',
    'temp-mail.org',
    'throwaway.email',
    'yopmail.com',
    'trashmail.com',
    'getnada.com',
    'dispostable.com',
    '10minutemail.com',
    'fakeinbox.com',
    'maildrop.cc',
    'mailnesia.com'
  ) THEN
    RAISE EXCEPTION 'Disposable email addresses are not allowed' USING ERRCODE = 'P0001';
  END IF;

  IF local_part ~ '^p[o0]{0,1}r{1,2}n?hub[0-9]+$' THEN
    RAISE EXCEPTION 'This email address is not allowed' USING ERRCODE = 'P0001';
  END IF;

  IF local_part ~ '^[0-9]{6,}$' THEN
    RAISE EXCEPTION 'This email address is not allowed' USING ERRCODE = 'P0001';
  END IF;

  IF local_part ~ '^(.)\1{5,}$' THEN
    RAISE EXCEPTION 'This email address is not allowed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_spam_auth_signup() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_before_insert_block_spam ON auth.users;
CREATE TRIGGER on_auth_user_before_insert_block_spam
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.block_spam_auth_signup();

COMMENT ON FUNCTION public.block_spam_auth_signup() IS
  'Rejects auth signups matching server-side emailSignupPolicy spam patterns.';
