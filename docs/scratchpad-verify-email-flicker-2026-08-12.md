# Scratchpad — Verify-email page flicker (2026-08-12)

## Report
Flickering/glitch on the "Check your email" page (`/verify-email`).

## Suspects
1. Cooldown interval effect remounting (`cooldownSeconds > 0` dependency).
2. `refreshProfile` effect + profile loading spinner in parent gate.
3. Auth session null after signup signOut → provider loading flashes.
4. EmailVerificationGate / VerifyEmailLayout remount.
5. Navigate effect when `isEmailVerified` toggles briefly.

## Evidence
- `VerifyEmailPage` had:
  ```ts
  useEffect(() => {
    if (profileLoading || !user) return
    void refreshProfile()
  }, [user, profileLoading, refreshProfile])
  ```
- `UserProfileProvider` already calls `refreshProfile` whenever `user` changes.
- When an unverified session lands on `/verify-email` (e.g. `ProtectedRoute` → verify), `profileLoading` false → page calls `refreshProfile` → loading true → false → effect again → infinite load cycle → visible flicker.
- Secondary: email preferred `user?.email` after query could flash empty on signOut; now query-first.

## Fix
- Removed the redundant `refreshProfile` effect.
- Keep only navigate-when-verified.
- Prefer `?email=` for subtitle stability.

