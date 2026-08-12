/*
  Harden email verification sync.

  Supabase "Confirm email" was disabled on hosted projects, so GoTrue sets
  auth.users.email_confirmed_at within ~15ms of signup. The previous
  sync_email_verified_on_confirm trigger copied that into
  user_profiles.email_verified_at, which defeated the app verification gate.

  Rules going forward:
  - Ignore near-instant auto-confirms (confirmation within 2s of created_at).
  - Real confirmations (user clicked the email link) still sync.
  - mark_email_verified() records now() so a later click is distinguishable
    from the original auto-confirm timestamp.
*/

CREATE OR REPLACE FUNCTION public.sync_email_verified_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL
    AND NEW.email_confirmed_at IS NOT NULL
    AND NOT public.auth_user_is_oauth(NEW)
    -- Auto-confirm (Confirm email disabled) happens in the same second as insert.
    -- A real email click is always later.
    AND NEW.email_confirmed_at >= NEW.created_at + interval '2 seconds'
  THEN
    UPDATE public.user_profiles
    SET email_verified_at = now(),
        updated_at = now()
    WHERE user_id = NEW.id
      AND email_verified_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_email_verified()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  confirmed_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email_confirmed_at INTO confirmed_at
  FROM auth.users
  WHERE id = uid;

  IF confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Email not confirmed';
  END IF;

  UPDATE public.user_profiles
  SET email_verified_at = now(),
      updated_at = now()
  WHERE user_id = uid
    AND email_verified_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_email_verified() TO authenticated;

COMMENT ON FUNCTION public.sync_email_verified_on_confirm() IS
  'Sets user_profiles.email_verified_at when auth email confirmation happens at least 2s after signup (ignores GoTrue auto-confirm).';
