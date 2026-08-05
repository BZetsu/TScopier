# Next LLM — Telegram Reconnect Storm Investigation & Fix

## Context (read this first)

You are picking up after a previous session that diagnosed a production outage:
- **All Telegram user listeners** entered reconnect death spirals simultaneously
- The system was rolled back to commit `01a2d913` (PR #43 — "feat/auth-fixes-to-main") on Railway, which **fixed the problem**
- The rollback was a **deployment rollback only** — `upstream/dev`, `upstream/staging`, `upstream/main` branches were **NOT force-pushed**. All commits including the problematic ones are still in the git history.
- No git reconciliation is needed — the history is intact

Your job: investigate root cause, design a better logging strategy, propose fixes, compare staging vs prod, and implement a solution that can be deployed forward (not rolled back forever).

---

## Step 1 — Investigate all git logs from rollback to latest

The safe baseline commit is:
```
01a2d913 Merge pull request #43 from tartarixinc/feat/auth-fixes-to-main
```

Current HEAD is at:
```
964152e3 Merge remote-tracking branch 'upstream/main' into feat/remaining-weekly-plan-items
```

There are **27 commits** between `01a2d913..HEAD`. These are the commits that touch Telegram-related code:

```
186c8d1c feat: Implement ensureSignalRow for signal persistence and FK recovery
03dffd53 feat: Enhance session management and recovery mechanisms
991bf6d2 fixed  CHANNEL_INVALID auto-disable error
ff483ae7 feat: Complete items 2.4, 3.2, patch script security from weekly plan
0df31750 telegram binary error fixed
af12737d AUTH_KEY_DUP_RECONNECT_DELAY_MS is now consistently configurable through...
b3a8f38a fix: await requestReconnect in _updateLoop TIMEOUT handler to break death spiral
ef01e883 fix: break QR login death spiral on AUTH_KEY_UNREGISTERED
f1981ad5 fix: make onError handler async to match expected signature
0218a215 fix: register onError handler to recover _updateLoop TIMEOUT death spiral
71194d3c perf(worker): add execution pipeline observability
```

### Do these investigations:

1. **`git log --oneline 01a2d913..HEAD -- worker/src/authKeyDuplicatedRecovery.ts`**
   — Only commit `af12737d` touches this file. This is the **prime suspect**.

2. **`git diff 01a2d913..HEAD -- worker/src/authKeyDuplicatedRecovery.ts`**
   — See the exact change that broke everything.

3. **`git log --oneline 01a2d913..HEAD -- worker/src/userListener.ts`**
   — All the commits that added `onError`, `noteMalformedRpcResult`, `ensureSignalRow`, etc.

4. **`git log --oneline 01a2d913..HEAD -- worker/src/sessionManager.ts`**
   — Section 5 realtime fix + auth config changes.

5. **`git log --oneline 01a2d913..HEAD -- worker/src/telegramClient.ts`**
   — BinaryReader fixes + connect-trace logging.

---

## Step 2 — Investigate the log dump for logging improvements

The logs showed these patterns (read `docs/telegram-reconnect.log` or ask the user for the raw log file):

### Patterns to extract:
1. **AUTH_KEY_DUPLICATED floods** — how many per minute, per user, total
2. **GramJS `console.log` noise** — lines like `[TelegramClient._onMessage]`, `[MTProtoSender]`, `sendBuffered` timing logs
3. **`_updateLoop TIMEOUT` frequency** — how often it fires, per user
4. **Flood-wait durations** — are they `FLOOD_WAIT_1`, `FLOOD_WAIT_2`, etc
5. **Reconnect cycle duration** — how long from first AUTH_KEY_DUP to recovery or exhaustion
6. **`readUInt32LE` / BinaryReader crashes** — frequency, line numbers

### Propose a logging strategy:
- **Replace GramJS `console.log`** with structured events (suppress them at the source in node_modules, or monkey-patch before import)
- **Aggregated flood-wait events** — instead of one log line per error, emit one event per 60s window with count
- **Health heartbeat** — periodic `LISTENER_HEALTHY` log with uptime, connected count, last event age
- **Structured reconnect events** — each reconnect cycle should have a unique cycle ID so you can trace the full lifecycle
- **Idempotency in logs** — every reconnect event should include: `cycleId`, `attempt`, `totalAttempts`, `reason`, `userId`. Same event shape for every reconnect so you can aggregate by cycleId. Never log the same error twice — deduplicate within a time window (e.g. `shouldEmitAuthKeyDupEvent` style but for all errors)

---

## Step 3 — Root cause: what caused ALL users to disconnect

### Primary root cause (CONFIRMED):

**File: `worker/src/authKeyDuplicatedRecovery.ts` — function `authKeyDupReconnectDelaysMs()`**

**Old code (safe, at `01a2d913`):**
```ts
export function authKeyDupReconnectDelaysMs(
  initialCooldownMs: number,
  authDupDelayMs: number,
): number[] {
  const first = Math.max(500, Math.min(120_000, initialCooldownMs))
  const second = Math.max(2_000, Math.min(60_000, authDupDelayMs))
  return [first, second, 15_000, 30_000]  // ← Hardcoded 4 attempts
}
```

**New code (broken, at `af12737d` and later):**
```ts
export function authKeyDupReconnectDelaysMs(
  initialCooldownMs: number,
  authDupDelayMs = authKeyDupReconnectDelayMs(),  // default: 30_000
  maxAttempts = authKeyDupMaxRecoveryAttempts(),    // default: 10
): number[] {
  const first = Math.max(500, Math.min(120_000, initialCooldownMs))
  const retry = Math.max(2_000, Math.min(120_000, authDupDelayMs))
  const attempts = Math.max(1, Math.min(100, Math.floor(maxAttempts)))
  return Array.from({ length: attempts }, (_, i) => (i === 0 ? first : retry))
}
```

With `authKeyDupMaxRecoveryAttempts()` defaulting to `10`:
```ts
export function authKeyDupMaxRecoveryAttempts(): number {
  return Math.max(1, Math.min(100, Math.floor(Number(process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS ?? 10))))
}
```

**Impact:**
- Old: `[~3.5s, 8s, 15s, 30s]` → 4 attempts, max ~56.5s per reconnect cycle
- New: `[~3.5s, 30s, 30s, 30s, 30s, 30s, 30s, 30s, 30s, 30s]` → 10 attempts, max ~273s per reconnect cycle
- **That's ~5× longer per reconnect cycle**

Additionally, the old `authKeyDupDeferredRetryMs()` function was **removed entirely**. It provided a single deferred retry at 60s after exhaustion. Now there's no recovery path — once exhausted, the user stays disconnected forever.

### Three aggravating factors (all in `worker/src/userListener.ts`):

**Factor 1 — `noteMalformedRpcResult` (line 3916):**
Catches GramJS internal `BinaryReader` crashes (`readUInt32LE`, `Cannot read properties of undefined`) and triggers `requestReconnect('malformed_rpc_result')`. Each crash adds another full 10-attempt reconnect cycle. During a flood-wait storm, these crashes happen repeatedly.

**Factor 2 — `onError` handler double-fire (line 431):**
The `onError` handler fires BOTH the `noteMalformedRpcResult` path AND, for `readUInt32LE`/`TIMEOUT` errors, can independently trigger `requestReconnect`. So one error → two concurrent reconnect cycles → 20 total reconnect attempts → 9+ minutes of reconnecting per error.

**Factor 3 — `ensureSignalRow` in hot path (line 2559, 2812):**
Every signal dispatch now does a Supabase upsert before proceeding. During network strain, this I/O fails, adding more error surface area. The `ensureSignalRow` import was added by commit `186c8d1c`.

### Three call sites that all use the new 10-attempt pattern:

1. **`forceReconnect`** (userListener.ts:3959) — the main reconnect loop
2. **`reconnectAndRetryDialogs`** (userListener.ts:1078) — AUTH_KEY_DUP on getDialogs
3. **`reconnectTelegramSession`** (sessionManager.ts:839) — user-initiated reconnect via HTTP

---

## Step 4 — Current git state & staging vs prod comparison

### Branches:
- `upstream/main` — production (Railway auto-deploys)
- `upstream/staging` — staging (Railway auto-deploys) — **3 commits ahead of main:**
  1. `b9cc9616` docs: staging test checklist + weekly plan update
  2. `964152e3` Merge remote-tracking branch 'upstream/main' into feat/remaining-weekly-plan-items
  3. `5ccf4276` feat: Section 5 — Realtime subscription reconnect gap fix
- `upstream/dev` — integration branch (no auto-deploy) — identical to `feat/remaining-weekly-plan-items`

### Current working branch:
`feat/remaining-weekly-plan-items` — 27 commits ahead of `01a2d913`.

### Staging vs prod difference: 
```
upstream/main..upstream/staging = 3 commits
```
Staging has: Section 5 (realtime reconnect gap fix) + docs. Neither has the rollback — **both staging and prod have the broken 10-attempt code**.

### What to do:
- Read `docs/staging-test-checklist.md` for the full staging validation plan
- Check `docs/railway-architecture.md` for deployment info
- Check `docs/staging-environment.md` for staging infra details

---

## Step 5 — Request additional logs where needed

Ask the user for:
1. **Raw production log file** (ideally a `.log` or `.txt` of the full reconnect storm)
2. **Staging logs** from the Railway listener for comparison (fewer users, should show same pattern)
3. **Current `.env` values** for `TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS`, `TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS`, `TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES` — are any of these set in production env?

---

## Step 6 — Implement the fix

### Fix 1: Cap reconnect attempts (surgical, minimum risk)
Change `authKeyDupMaxRecoveryAttempts()` default from **10 back to 4**:
```ts
export function authKeyDupMaxRecoveryAttempts(): number {
  return Math.max(
    1,
    Math.min(100, Math.floor(Number(process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS ?? 4))),
  )
}
```

Or even better, restore the original hardcoded pattern with escalation: `[first, max(2000, authDupDelayMs), 15000, 30000]`. The old pattern had 3 different delay values (cooldown, retry, 15s, 30s) — the new pattern uses the same `retry` value for all subsequent attempts, which is less effective.

### Fix 2: Gate `noteMalformedRpcResult` reconnect trigger
GramJS internal crashes (`BinaryReader` errors) should NOT trigger a full reconnect cycle. They should just log and let the connection recover naturally. Only AUTH_KEY_DUPLICATED should trigger reconnects.

Options:
- Remove the `noteMalformedRpcResult` → `requestReconnect` path entirely (just log it)
- Or track it separately with its own attempt budget (not sharing the AUTH_KEY_DUP budget)

### Fix 3: Stop the `onError` double-fire
The `onError` handler should either:
- Route everything through `noteMalformedRpcResult` (single path)
- Or have `noteMalformedRpcResult` return a boolean indicating whether it handled it, and skip the independent reconnects

Currently it does BOTH: calls `noteMalformedRpcResult` AND independently checks for `readUInt32LE`/`TIMEOUT`.

### Fix 4: Idempotent reconnect dedup
The `requestReconnect` currently deduplicates via `reconnectInFlight`. But errors can still stack while a reconnect is inflight (they queue up). After each reconnect, check if another error arrived during the cycle and if so, start a new cycle immediately. This prevents error storms from creating cascading reconnects.

### Verification:
1. Run `npm --prefix worker test` to verify all existing tests pass
2. Check `worker/src/authKeyDuplicatedRecovery.test.ts` — the test at line 27 expects `[3500, 30000, 30000, 30000]` for 4 attempts. If you change the default back to 4, this test should still pass since it explicitly passes `4` as the third argument.
3. The test at line 38 expects 10 items for 10 attempts — this tests the function behavior, not the default. Should still pass.

---

## Files you will touch

| File | What to change |
|---|---|
| `worker/src/authKeyDuplicatedRecovery.ts` | Cap default to 4 attempts (or restore old pattern) |
| `worker/src/userListener.ts` | Gate `noteMalformedRpcResult` reconnect; fix `onError` double-fire; add cycleId logging |
| `worker/src/sessionManager.ts` | Possibly nothing — reconnectTelegramSession calls the same function |
| `worker/src/authKeyDuplicatedRecovery.test.ts` | Update tests if defaults change |
| `docs/PROJECT_MEMORY.md` | Append a changelog entry at the top of `## Changelog` |

---

## Key references

- **Safe baseline:** commit `01a2d913` (PR #43 — `feat/auth-fixes-to-main`)
- **Breaking commit:** `af12737d` (Emma, Jul 27 — changed reconnect delays from 4 to 10 attempts)
- **Broken function:** `worker/src/authKeyDuplicatedRecovery.ts:21-30` — `authKeyDupReconnectDelaysMs()`
- **3 call sites:** userListener.ts:3959 (`forceReconnect`), userListener.ts:1078 (`reconnectAndRetryDialogs`), sessionManager.ts:839 (`reconnectTelegramSession`)
- **Aggravating factors:** userListener.ts:3916 (`noteMalformedRpcResult`), userListener.ts:431 (`onError` handler), userListener.ts:93 + 2559 + 2812 (`ensureSignalRow` in hot path)
- **Test file:** `worker/src/authKeyDuplicatedRecovery.test.ts`

---

## After implementing

1. Update `docs/PROJECT_MEMORY.md` with a new changelog entry
2. Push to `origin/feat/fix-telegram-reconnect-storm`
3. Create a PR to `upstream/dev`
4. Ask user to verify on staging before promoting to main
