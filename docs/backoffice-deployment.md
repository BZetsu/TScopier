# Backoffice deployment (backoffice.tscopier.ai)

## App location

- Source: `apps/backoffice`
- Build command: `npm --prefix apps/backoffice run build`
- Publish directory: `apps/backoffice/dist`
- SPA redirects: `apps/backoffice/netlify.toml`

## Required environment variables

Set these for the backoffice site/app:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Admin authorization model

- Frontend gate: `user_profiles.is_admin` via `apps/backoffice/src/hooks/useAdminProfile.ts`
- Server gate: every admin edge endpoint enforces `requireAuthedAdmin(...)`
  from `supabase/functions/_shared/adminAuth.ts`

## Admin edge endpoints

- `supabase/functions/admin-query/index.ts` (read surfaces)
- `supabase/functions/admin-mutate/index.ts` (mutations)

## Audit trail

- Schema migration: `supabase/migrations/20260529201000_admin_audit_logs.sql`
- Helper: `supabase/functions/_shared/adminAudit.ts`
- Every mutation in `admin-mutate` writes an audit record.
