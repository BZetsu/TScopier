# Project Learnings

> Managed by `/learn`. Append-only — latest entry wins on conflicts.

## Patterns

## Pitfalls

### always-use-a-scratchpad
- **Insight:** Always create and maintain a scratchpad (`docs/scratchpad-<issue>-<date>.md`) at the very start of any diagnosis, before touching code or DB. Record the facts from the report, the questions to answer, hypotheses, and verified evidence, and keep it updated as the investigation progresses — it is the single source of truth. Mandated in AGENTS.md under "Diagnosis & Problem-Solving"; this prevents re-deriving conclusions, keeps follow-up sessions coherent, and anchors the eventual PROJECT_MEMORY entry.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** docs/scratchpad-unknown-ticket-2026-08-10.md, AGENTS.md
- **Date:** 2026-08-10

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

### unknown-ticket-regex-six-sites
- **Insight:** The "broker position is gone" benign-error regex `/not\s+found|already\s+closed|invalid\s+ticket|no\s+such\s+order/` is duplicated in SIX worker files (partialTpMonitor, autoManagementMonitor, cweCloseMonitor, trailingStopMonitor, managementExecutor, forceCloseSignalTrades). FxSocket's real reply `unknown ticket` was only added to `partialTpMonitor.ts` in the first fix, so the other five monitors kept retrying dead tickets forever (~400ms tick → 672+ failures in 12 min). Fixing ONE site does not fix the class. When a broker-error string is added to one monitor's benign list, grep ALL six sites.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** worker/src/partialTpMonitor.ts, worker/src/autoManagementMonitor.ts, worker/src/cweCloseMonitor.ts, worker/src/trailingStopMonitor.ts, worker/src/tradeExecutor/managementExecutor.ts, worker/src/forceCloseSignalTrades.ts, docs/unknown-ticket-auto-be-investigation-2026-08-10.md, docs/scratchpad-unknown-ticket-2026-08-10.md
- **Date:** 2026-08-10

### auto-be-tp-hit-dead-ticket
- **Insight:** `move_sl_to_entry_after_mode: "tp_hit"` (auto BE after TP1 hit) is dangerous when the broker-side TP closes the position BEFORE the monitor's `orderModify` runs: the monitor computes BE SL from `entry + breakeven_offset_pips`, fires `orderModify` on a ticket the broker already closed → `unknown ticket`. The trade row in `trades` stays `status='open'` with `auto_be_applied_at=null`, so the monitor re-selects it every tick forever. The DB only learns of the close if reconcile/ghost-close detects it; on an account where no order_send logs exist and reconcile deferred, nothing marks it closed. Symptom signature: `trade_execution_logs` full of `auto_be/failed/unknown ticket` rows with cycling tickets, no `order_send` rows.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** worker/src/autoManagementMonitor.ts, worker/src/autoManagement.ts, docs/unknown-ticket-auto-be-investigation-2026-08-10.md, docs/scratchpad-unknown-ticket-2026-08-10.md
- **Date:** 2026-08-10

### supabase-management-api-query
- **Insight:** Direct read-only queries against prod/staging Supabase work via the Management API: `POST https://api.supabase.com/v1/projects/<ref>/database/query` with `Authorization: Bearer <token from ~/.supabase/access-token>` and `{"query": "..."}`. No psql/DB URL needed. Prod ref: `sxkpcovbyaficvtkpsdo`, staging: `axdcledcyhyvzrnfkwat`. Schema gotchas: user table is `user_profiles` (not `profiles`); `listener_events` has no `signal_id` column (use `telegram_message_id` + `channel_row_id`); `basket_reconcile_jobs` has no `trade_id`; `partial_tp_legs` has no `updated_at`.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** scripts/apply-migrations.py, docs/scratchpad-unknown-ticket-2026-08-10.md
- **Date:** 2026-08-10

## Preferences

### emma-memory-separate-file
- **Insight:** Emma's changelog entries must live in `docs/PROJECT_MEMORY-EMMA.md`, never in `docs/PROJECT_MEMORY.md` — her entries sit at the top of the changelog and collide with every other session's memory merge, causing repeatable conflicts on dev and staging.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** docs/PROJECT_MEMORY-EMMA.md, docs/PROJECT_MEMORY.md
- **Date:** 2026-08-08

## Architecture

## Tools
