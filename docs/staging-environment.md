# Staging Environment & Deployment Pipeline

## Branch strategy

```
upstream/main ────────────────────────── production (Netlify prod + Railway prod)
   └── upstream/staging ─────────────── staging (Netlify staging + Railway staging)
         └── upstream/dev ───────────── integration branch (no auto-deploys)
               └── feature/* ────────── individual branches off dev, PR into dev
```

- **`main`** = production. Merges to `main` trigger production deploys.
- **`staging`** = staging environment. Code promoted from `dev` after admin approval.
- **`dev`** = integration branch. All feature/fix branches PR into `dev`. No auto-deploys.
- **`feature/*`** = individual work branches, branch off `dev`, PR back to `dev`.
- **Promotion**: `dev` → `staging` (after admin approval) → `main` (after staging verification).
- No direct commits to `main`, `staging`, or `dev`. Always work in a feature branch.

## Git sync & workflow (avoid merge conflicts)

### Remotes

```bash
origin   = BZetsu/TScopier       (your fork — push/pull freely)
upstream = tartarixinc/TScopier  (production — read + push via SSH)
```

Production reference clone at `~/projects/TScopier-production` (read-only, no workflow involvement).

### Daily sync — before starting work

```bash
git checkout dev
git pull upstream dev           # pull latest dev into your local dev
git push origin dev              # update your fork on GitHub
```

This keeps your fork's `dev` identical to production's `dev`. Any feature branch you create from here starts from the latest integration branch.

### Feature branch workflow

```bash
# Step 1: Create feature branch from latest dev
git fetch upstream dev                # Download latest dev from production repo
git checkout -b feat/my-thing upstream/dev   # Create branch "feat/my-thing" starting at upstream/dev

# Step 2: Work, commit, push to your fork
git add .                             # Stage all changes for commit
git commit -m "feat: add trailing stop"  # Save snapshot with a message
git push origin feat/my-thing         # Upload your branch to your fork (origin) on GitHub

# Step 3: Before pushing to upstream/dev — rebase on latest dev
git fetch upstream dev                # Download any new changes on dev since you started
git rebase upstream/dev               # Replay your commits on top of the latest dev
# If conflicts appear, fix them now, then: git rebase --continue
git push origin feat/my-thing --force-with-lease  # Update your fork branch after rebase

# Step 4: Push to upstream/dev
git push upstream feat/my-thing:dev   # Take feat/my-thing and overwrite upstream/dev with it
```

### Why rebase (not merge)

```
Before rebase:
  upstream/dev  ── D ── E        (latest on production dev)
  feat/my-thing ── A ── B ── C  (your work, based on older dev)

After rebase:
  upstream/dev  ── D ── E ── A' ── B' ── C'
                            ^ your commits replayed on top
```

Rebasing places your commits **after** whatever is already on `upstream/dev`. The push shows only your changes — no merge commits, no noise. If a conflict arises, you fix it during rebase (not in the push).

### Why small, frequent pushes

One feature or fix per push. Touching 3 files = near-zero conflicts. Touching 30 files = guaranteed conflict. Small pushes are also easier to review and faster to merge.

### Hotfix workflow (emergency)

For urgent production fixes, bypass staging but keep dev in sync:

```bash
# Branch from upstream/main
git fetch upstream main
git checkout -b hotfix/critical-fix upstream/main
git commit -m "fix: critical issue"
git push origin hotfix/critical-fix
# → PR directly into upstream/main (expedited review)
# After merge, cherry-pick the fix into dev:
git fetch upstream main dev
git checkout upstream/dev
git cherry-pick <commit-hash>
git push upstream HEAD:dev
```

### Pull dev changes mid-work

If `dev` advanced while you're in the middle of a feature:

```bash
git fetch upstream dev
git rebase upstream/dev        # replay your commits on top of latest dev
# fix any conflicts → continue working
```

Do this often — the more frequently you rebase, the smaller the conflicts.

## The three branches on production

### `upstream/main` — Production live code

What it is: The code that real users see and use.
- Railway auto-deploys from `main` → worker serves all copier users
- Netlify auto-deploys from `main` → `tscopier.ai` / `app.tscopier.ai`
- Connects to **production Supabase** (real data, real users)
- **Never push here directly. Always PR with review.**

### `upstream/staging` — Testing ground

What it is: A clone of the production environment for validation.
- Staging Railway auto-deploys from `staging`
- Staging Netlify auto-deploys from `staging` → `staging-tscopier.netlify.app`
- Connects to **staging Supabase** (separate DB, no risk to real data)
- **Test everything here before sending to production.**

### `upstream/dev` — Integration branch

What it is: The shared integration branch where all feature work merges before staging.
- **No auto-deploy.** Railway and Netlify ignore this branch completely.
- All developers PR their feature branches here.
- Once code on `dev` is tested and approved by admin, it's promoted to `staging`.

### `feature/*` — Feature branches

What they are: Individual branches for specific features or fixes.
- Branch off `upstream/dev`, not `main`.
- Name pattern: `feat/description` or `fix/description`.
- PR into `upstream/dev` when ready for review.
- Delete after merge.

### Analogy

```
feature/* = your desk.       Build your thing here, away from others.
dev       = team's table.    Everyone puts their pieces together here.
staging   = testing room.    Test the assembled thing before showing anyone.
main      = the live stage.  Real users see this.
```

## Step-by-step: moving code through the pipeline

You have two places you can run git commands from:

| Repo | Location | Remote name | Points to |
|------|----------|-------------|-----------|
| **Fork repo** | `~/projects/TSCopier` | `upstream` | tartarixinc/TScopier |
| **Production clone** | `~/projects/TScopier-production` | `origin` | tartarixinc/TScopier |

You can use either one. The production clone is simpler because you don't need to type `upstream` — just `origin`.

## Feature lifecycle — step by step

### Step 1: Create feature branch

```bash
# Download the latest code from the production repo's dev branch to your computer
# "fetch" = download but don't merge. upstream = the production repo.
git fetch upstream dev

# Create a new branch called feat/dark-mode
# -b = create the branch
# upstream/dev = "start this branch from exactly where upstream/dev is right now"
# This gives you an isolated workspace with the exact same code as dev
git checkout -b feat/dark-mode upstream/dev
```

**Why this matters:** If you branched from `main` instead of `dev`, your branch would include old code that's not on `dev`. When you try to push to `dev`, git would complain about missing commits. Branching from `dev` guarantees a clean push.

### Step 2: Work, commit, push to fork

```bash
# Stage all changed files for commit
# "staging area" = the list of files that will be included in the next snapshot
git add .

# Take a snapshot of all staged changes with a message
# -m "message" = the commit message describing what changed
# This creates a permanent entry in git history
git commit -m "feat: add dark mode toggle"

# Upload your branch to your fork (origin) on GitHub
# origin = https://github.com/BZetsu/TScopier.git (your personal copy)
# This backs up your code — even if your hard drive dies, it's on GitHub
git push origin feat/dark-mode
```

**Why origin first:** You have full control over your fork. You can push 100 times and it doesn't affect anyone. The production repo (upstream) is shared — you push there only when ready.

### Step 3: Push feature to upstream/dev

```bash
# Push your feature branch directly onto the dev branch of the production repo
# upstream = git@github.com:tartarixinc/TScopier.git (the production repo)
# feat/dark-mode:dev = "take my local branch feat/dark-mode and put it on the remote branch called dev"
# This replaces whatever was on dev with your feature code
git push upstream feat/dark-mode:dev
```

**What `feat/dark-mode:dev` means:**
- Left of `:` = your local branch name (source)
- Right of `:` = the remote branch name (destination)
- So `feat/dark-mode:dev` = "push local `feat/dark-mode` to remote `dev`"

**What if someone else pushed to dev before you?** Git will reject it (non-fast-forward error). You'd need to:
```bash
git fetch upstream dev           # download their changes
git rebase upstream/dev          # replay your commits on top of theirs
git push upstream feat/dark-mode:dev  # try again
```

### Step 4: Admin promotes dev → staging

Your code is now on `upstream/dev`. The admin runs (in the production clone):

```bash
# Download the latest state of both dev and staging branches
git fetch origin dev staging

# Push dev's content onto staging
# dev:staging = "take remote branch dev and put it on remote branch staging"
# Now staging has exactly what dev has — including your dark mode code
git push origin dev:staging
```

**What happens automatically after this push:**
- **Railway** detects the push to `staging` branch → rebuilds + deploys the worker Docker containers (listener, trade, backtest)
- **Netlify** detects the push to `staging` branch → rebuilds + deploys the frontend
- After ~2-5 minutes, the staging environment is live

**Why this is admin-only:** If staging breaks, it blocks testing. Admin decides when code is ready to test.

### Step 5: Verify on staging

No commands — just browser testing:
- Go to staging site and verify the feature works
- Check Railway logs for FATAL errors
- Report to admin: "Staging verified" or "Found issue with X"

### Step 6: Admin promotes staging → main

After you confirm staging is good, admin runs:

```bash
# Download the latest staging and main branches
git fetch origin staging main

# Push staging's content onto main
# staging:main = overwrite main with whatever is on staging
# Railway + Netlify auto-deploy to production
git push origin staging:main
```

**What happens automatically:**
- **Railway** detects push to `main` → deploys workers to production
- **Netlify** detects push to `main` → deploys frontend to `app.tscopier.ai`
- Real users now see your feature live

### Step 7: Cleanup

After your code is in production and merged into `upstream/dev`:

```bash
# Switch back to the dev branch
# You were on feat/dark-mode — switch to dev so you can sync
git checkout dev

# Download the latest dev from upstream (which now includes your merged code)
# This syncs your local dev with what's on the production repo
git pull upstream dev

# Upload your updated dev to your fork on GitHub
# Now your fork's dev matches the production repo's dev
git push origin dev

# Delete your local feature branch
# -d = safe delete (won't delete if commits aren't merged)
# The code is safely in dev now — no need to keep the branch
git branch -d feat/dark-mode

# Delete the feature branch from your fork on GitHub
# --delete = remove the remote branch
# Cleans up your fork so you don't have stale branches lying around
git push origin --delete feat/dark-mode
```

### Summary of all moves in the pipeline

| Move | Who | Command |
|------|-----|---------|
| Feature branch → `dev` | You | `git push upstream feat/xxx:dev` |
| `dev` → `staging` | Admin | `git push origin dev:staging` |
| `staging` → `main` | Admin | `git push origin staging:main` |

## Infrastructure

| Service | Production | Staging | Isolation |
|---------|-----------|---------|-----------|
| Supabase project | `sso.tscopier.ai` | Separate project (e.g. `staging-tscopier`) | **Completely separate DB** — no data leak possible |
| Netlify site | `tscopier.ai` / `app.tscopier.ai` | Separate site (e.g. `staging-tscopier.netlify.app`) | Separate site config, separate env vars |
| Railway project (worker) | Production Railway | Separate Railway project | Separate env, separate Docker deploys |
| Redis (Upstash) | Production instance | Separate instance (or skip for staging) | Separate data store |
| Stripe | Live keys | Test mode keys | Test data only |
| FxSocket | Production key | Same or separate key | Broker calls go to demo/test accounts |
| Resend | Production API key | Test API key (or disable email) | No real emails sent |

## Service-level deployment

### Frontend (Netlify)

| Branch | Netlify site | Deploy trigger |
|--------|-------------|----------------|
| `main` | Production (tscopier.ai) | PR merge to `main` |
| `staging` | Staging (staging-tscopier.netlify.app) | PR merge to `staging` |

**Env vars per site** (set in Netlify UI → Site settings → Environment variables):
- Production: `VITE_SUPABASE_URL` → prod Supabase, `VITE_APP_URL` → `https://app.tscopier.ai`
- Staging: `VITE_SUPABASE_URL` → staging Supabase, `VITE_APP_URL` → `https://staging-tscopier.netlify.app`

### Worker (Railway)

| Branch | Railway project | Service | Deploy trigger |
|--------|----------------|---------|----------------|
| `main` | Production | `worker` (or split shards) | Automatic on merge |
| `staging` | Staging | `worker` (single `WORKER_ROLE=all`) | Automatic on merge |

**Staging worker runs `WORKER_ROLE=all`** with 1 replica. Because it connects to the staging Supabase project (zero active Telegram sessions), it cannot interfere with production listeners. The lease system provides cross-process safety if a misconfiguration ever pointed a staging worker at the prod DB — but using separate Supabase projects makes that impossible.

### Edge Functions (Supabase)

Edge functions are deployed per-Supabase-project:
```bash
# Staging
supabase functions deploy parse-signal --use-api

# Production (when promoting)
supabase functions deploy parse-signal --use-api
```

Edge function secrets are also per-project:
```bash
supabase secrets set FXSOCKET_API_KEY=...
```

### Database Migrations (Supabase)

Migrations are run against each project's DB independently:
```bash
# Staging (first — validate)
supabase db push

# Production (after validation)
supabase db push
```

## Safety rules for database migrations

1. **Never write a migration that deletes columns or tables** without a two-phase plan:
   - Phase 1: Mark column as deprecated (keep reading it, stop writing)
   - Phase 2: Drop it after confirming no code references remain

2. **Always test on staging first** — run migrations against staging DB, verify the worker + frontend work with the new schema.

3. **Prefer additive changes** — `ALTER TABLE ADD COLUMN`, `CREATE INDEX CONCURRENTLY`, `CREATE TABLE`. These are safe to apply to production without downtime.

4. **Backward-compatible schema changes** — new code reads old columns and writes new ones during cutover. Old code (if still running during deploy) ignores new columns.

5. **Use `IF NOT EXISTS` / `IF EXISTS`** — all migrations should be idempotent (safe to run twice).

## Promotion pipeline

```
feature/* ──→ upstream/dev ──→ upstream/staging ──→ upstream/main
  (work)       (review+merge)    (validate)           (production)
                  ↑                 ↑
            Admin approves    Admin approves
```

**Promotion is done by admin/CTO only.** You submit PRs; admin merges `dev → staging` and `staging → main`.

### Before promotion (dev → staging)

- [ ] Fork branch merged into `upstream/dev`
- [ ] All migrations applied to staging Supabase, verified working
- [ ] Frontend builds on staging Netlify, no chunk load errors
- [ ] Staging worker starts without FATAL/error logs
- [ ] Edge functions deployed to staging, health-checked
- [ ] All tests pass: `npm test` + `npm run test:worker`
- [ ] TypeScript compiles: `npm run build`
- [ ] Lint passes: `npm run lint`

### The PR (staging → main) — Admin only

1. Open PR from `staging` into `main`
2. Reviewer checks:
   - Any migration that could break production? (see safety rules above)
   - Any env var changes documented?
   - Any worker config changes that affect production behavior?
3. Merge to `main`

### Post-merge rollout

| Step | Action | Rollback |
|------|--------|----------|
| 1 | **Run migrations on prod DB** via `supabase db push` | Run reverse migration (write manually if needed) |
| 2 | **Deploy edge functions** to prod Supabase | Redeploy previous version |
| 3 | **Deploy frontend** (auto — Netlify builds `main`) | Netlify instant rollback in UI |
| 4 | **Deploy worker** (auto — Railway deploys `main`) | Railway rollback to previous deploy |
| 5 | **Smoke test** — `/health` on listener + trade worker, check logs for FATAL | — |

### Rollback procedure

| Scenario | Action |
|----------|--------|
| Frontend regression | Netlify → Deploys → select last known good deploy → Publish |
| Worker crash | Railway → service → Deployments → rollback to previous |
| Edge function error | `supabase functions deploy <name> --use-api` with previous code |
| Bad migration | Deploy reverse migration SQL (write manually). Never `DROP` in prod without two-phase plan |
| Data corruption | Restore from Supabase point-in-time backup |

## Production incident: hotfix flow

For urgent production issues, skip staging:

```bash
# Work in fork, then PR directly to upstream/main
# Or push directly to upstream from production clone:
git checkout main
git checkout -b hotfix/description
# fix the issue
git commit -m "fix: ..."
git push upstream hotfix/description
# PR directly into main, expedited review
# After merge, cherry-pick the fix into staging AND dev:
git checkout staging
git cherry-pick <commit-hash>
git push upstream staging
git checkout dev
git cherry-pick <commit-hash>
git push upstream dev
```

This keeps staging and dev in sync with main while allowing fast production fixes.

## Env var management rules

- **Never commit `.env` files.** `.env` is in `.gitignore`.
- **`.env.example` is the source of truth** for what vars exist. Update it when adding new vars.
- **Supabase Edge secrets** are set via `supabase secrets set`, never in `.env` or Netlify env.
- **Worker secrets** (`WORKER_INTERNAL_TOKEN`, `BROKER_CREDENTIALS_ENCRYPTION_KEY`) are generated externally (`openssl rand -hex 32`) and set in Railway env.
- **Staging uses different secrets** from production. Never copy production secrets to staging.
