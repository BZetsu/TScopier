# Scratchpad — Email verification bypass (2026-08-12)

## Report
Without clicking the verification button/link, user can still log in with the same credentials and access the app.

## Facts
- Frontend has multiple enforcement points:
  - `AuthPage` login: after `signInWithPassword`, checks `isEmailVerified`; if false → `signOut` + navigate `/verify-email`
  - `ProtectedRoute`: redirects unverified users to `/verify-email`
  - `EmailVerificationGate`: same for non-exempt paths
  - `isEmailVerified` for email/password requires `user_profiles.email_verified_at` (not merely Supabase `email_confirmed_at`)
- DB: `email_verified_at` set for OAuth on profile insert; for email users only via `sync_email_verified_on_confirm` when `auth.users.email_confirmed_at` flips null→not null, or via `mark_email_verified()` RPC
- Signup signs out unverified users and sends them to `/verify-email`

## Questions
1. Is Supabase "Confirm email" disabled on staging/prod (so password login succeeds without confirmation)?
2. Is `email_verified_at` being set on signup without clicking the link?
3. Is a gate missing on some route path?
4. Is the user testing an environment/build that does not include the gates?
5. Does `loadUserProfile` / profile loading race allow a brief or permanent bypass?

## Hypotheses
H1: Supabase confirm-email is off → login succeeds; AND `email_verified_at` is incorrectly populated → gates pass.
H2: Supabase confirm-email is off → login succeeds; gates should block, but something makes `isEmailVerified` true (OAuth mis-detect, wrong profile row).
H3: Gates exist in code but deployed app is old / different branch.
H4: Profile loading fails open (treats missing profile as verified) — code review says fail-closed; disconfirm unless different path.
H5: User still has an active session from signup before signOut (session persistence race).

## Evidence log
- Staging + prod: recent email signups have `email_confirmed_at - created_at` ≈ 7–28ms → **Confirm email is OFF** (GoTrue auto-confirm).
- Staging `tartarix-test5` / `tartarix-test2`: `email_verified_at` equaled `email_confirmed_at` at signup; `last_sign_in_at` moments later without a human email click.
- Live `sync_email_verified_on_confirm` copied any null→non-null `email_confirmed_at` into `user_profiles.email_verified_at`, so the app gate treated auto-confirm as “verified”.
- Frontend gates (`AuthPage`, `ProtectedRoute`, `EmailVerificationGate`) were correct; they trusted a flag the DB set too early.

## Root cause (CONFIDENT)
1. Supabase Auth “Confirm email” disabled on staging and production.
2. DB trigger synced that instant auto-confirm into `email_verified_at`.
3. App access checks `email_verified_at` → allowed login without clicking the verification email.

## Fix applied
1. Migration `20260812120000_harden_email_verified_sync.sql`: ignore confirms within 2s of `created_at`; `mark_email_verified()` sets `now()`.
2. Applied on staging (`axdcledcyhyvzrnfkwat`) and prod (`sxkpcovbyaficvtkpsdo`).
3. Cleared staging auto-synced `email_verified_at` rows (incl. tartarix-test*) so retest works. Did **not** clear prod (grandfather existing users).
4. `send-verification-email`: prefer `signup` link, fallback `magiclink` (deploy pending approval).
5. **Still required in Dashboard:** enable Authentication → Providers → Email → **Confirm email** on staging and prod.
