# Scratchpad — Referral field shows "verify-email" (2026-08-12)

## Report
Referral code (optional) input shows `verify-email` without the user typing it.

## Likely cause
Route `/:referralCode` or referral capture treats path segment `verify-email` as a referral code and stores it in session/local storage, which SignupPage then prefills.

## Evidence
- App route `/:referralCode` was declared **before** `/verify-email` / `/pricing`.
- `verify-email` matches `referralCodeLooksValid` (`\S{3,32}`), so `ReferralCodeRedirect` sent users to `/signup?ref=verify-email` and stored it.
- Signup prefills from `?ref=` / localStorage → field shows `verify-email`.

## Fix
1. Reserved path blocklist in `referralCodeLooksValid` (includes `verify-email`).
2. Move `/:referralCode` after all real app routes.
3. `loadStoredReferralCode` clears previously stored reserved junk.
4. Unit tests for reserved segments.

