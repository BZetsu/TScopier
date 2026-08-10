# Project Learnings

> Managed by `/learn`. Append-only — latest entry wins on conflicts.

## Patterns

## Pitfalls

### push-wrong-staging-branch
- **Insight:** Never push to upstream/staging with `git push upstream staging` — a stale local branch literally named `staging` (merging Emma's layering fix, commit 75f8e56e) diverges from upstream/staging and gets rejected as non-fast-forward. Always push the worktree branch with an explicit refspec: `git push upstream push-sentry/staging:staging`.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** docs/PROJECT_MEMORY.md, docs/PROJECT_MEMORY-EMMA.md
- **Date:** 2026-08-08

### verify-fast-forward-before-push
- **Insight:** Before pushing any branch to upstream, prove it is a clean fast-forward with `git merge-base --is-ancestor upstream/<branch> <local-branch>` and confirm no content is lost with `git log upstream/<branch>..<local-branch>` — this caught both the wrong-branch push and the EMMA split sweep (anchor commit that did not exist on staging).
- **Confidence:** 10/10
- **Source:** learn
- **Files:** docs/PROJECT_MEMORY.md
- **Date:** 2026-08-08

## Preferences

### emma-memory-separate-file
- **Insight:** Emma's changelog entries must live in `docs/PROJECT_MEMORY-EMMA.md`, never in `docs/PROJECT_MEMORY.md` — her entries sit at the top of the changelog and collide with every other session's memory merge, causing repeatable conflicts on dev and staging.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** docs/PROJECT_MEMORY-EMMA.md, docs/PROJECT_MEMORY.md
- **Date:** 2026-08-08

## Architecture

## Tools
