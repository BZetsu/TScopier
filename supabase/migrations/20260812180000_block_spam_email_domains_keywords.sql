/*
  Broaden spam signup block:
  - adult / spam brand domains (pornhub.com, xvideos.com, …)
  - keyword substrings in local-part or domain (porn, gay, xxx, …)
  Keeps prior pornhub-local, numeric-local, disposable, and repeated-char rules.
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

  IF domain_part IN (
    'pornhub.com',
    'pornhub.net',
    'pornhub.org',
    'xvideos.com',
    'xnxx.com',
    'xhamster.com',
    'redtube.com',
    'youporn.com',
    'onlyfans.com',
    'brazzers.com',
    'spankbang.com'
  ) THEN
    RAISE EXCEPTION 'This email address is not allowed' USING ERRCODE = 'P0001';
  END IF;

  -- Keywords in local-part or domain (gaylord297426@…, …@something-porn.tld, etc.)
  IF local_part ~ '(pornhub|porhub|xvideos|xnxx|xhamster|redtube|youporn|onlyfans|brazzers|spankbang|gayporn|sexhub|porn|xxx|nsfw|gay)'
     OR domain_part ~ '(pornhub|porhub|xvideos|xnxx|xhamster|redtube|youporn|onlyfans|brazzers|spankbang|gayporn|sexhub|porn|xxx|nsfw|gay)' THEN
    RAISE EXCEPTION 'This email address is not allowed' USING ERRCODE = 'P0001';
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

COMMENT ON FUNCTION public.block_spam_auth_signup() IS
  'Rejects auth signups matching spam domains, keywords, and emailSignupPolicy patterns.';
