# Incident: same "Close all trades now" signal — prod skipped, staging executed

- **Date detected:** 2026-11-11 · **Date fixed & deployed to staging:** 2026-11-12
- **Status:** Fixed — staging; production pending decision
- **Severity:** Medium (one real instruction dropped; no incorrect trades opened)
- **Component:** signal parsing pipeline — rules engine → stage-2 AI → GPT-4o reviewer
- **Root cause:** a 50 %-confidence AI answer became the final decision because the
  reviewer stage had no trigger for conflicts, unconfirmed cancels, or low confidence
- **Rendered report:** `incident-2026-11-11-close-all-prod-staging-divergence.pdf`

## Plain English

On 11 November at 10:28:54, the exact same message — "Close all trades now" — was
posted once to a test channel that both production and staging follow. Staging closed
the open trades. Production did nothing and reported "Must be a reply to the original
signal". The rules engine read the message correctly in both places. The difference
came from the AI that double-checks every message: it answered correctly on staging
and misread the instruction as a cancellation on production, at only 50 % certainty.
Because the message looked executable, the third, stronger reviewer was never called,
and the uncertain guess became the final answer. We fixed this by forcing the reviewer
to run whenever the rules and the AI disagree, whenever the AI claims a cancellation
the rules never saw, and whenever an actionable answer is less than 70 % certain — and
by writing two unbreakable rules into the AI's own instructions. The fix is deployed
to staging and verified live.

## Issue encountered

Same second, same channel, same message text (`telegram_message_id 642`):

| | Staging | Production |
|---|---|---|
| Received | 2026-11-11 10:28:54 (WAT) | 2026-11-11 10:28:54 (WAT) |
| Rules engine (stage 1) | `close`, confidence 0.92 | `close`, confidence 0.92 |
| AI (stage 2) | `close`, confidence 0.95, symbol XAUUSDM | **`cancel_pending`, confidence 0.50**, no symbol |
| Reviewer (stage 3) | not called | **not called** |
| Final decision | `close` → **executed**, 2 successful closes | `cancel_pending` → **skipped**, `delete_pendings_requires_reply` |

Production itself parsed the same message correctly five other times that day
(05:55, 06:23, 10:01, 10:16, 10:26 UTC) — only this one run diverged, proving the
outcome varied run-to-run rather than being an environment or code difference.

## Affected user(s)

| Scope | Signal / period | Outcome |
|---|---|---|
| Test account `b97eebf3`, channel SIGNALS TESTER (prod) | "Close all trades now", 2026-11-11 10:28:54 | Skipped — no trades closed |
| Prod-wide, last 30 days | "close read as cancel" family | 5 messages dropped |
| Prod-wide, last 30 days | "rules-unread read as cancel" family (e.g. `BUY LIMITS GOLD @ …`) | 91 messages across up to 8 users/day — entries never placed, real cancels dropped |
| Prod-wide, last 30 days | actionable AI answers below 0.70 confidence accepted alone | 108 signals (83 skipped / 23 executed) |
| Prod-wide, last 7 days | final answers of `uncertain` (human review switched off) | 298 silent skips |

No incorrect trades were opened and no funds were lost; the damage was dropped or
mis-scoped instructions.

## Root cause

1. **The rules engine's confidence for management messages is 0.92, but the
   fast-path threshold was 0.99** — so a plain "Close all trades now" always went to
   the AI for a final answer it did not need.
2. **The AI is not deterministic.** On staging it agreed with the rules (`close`,
   0.95); on prod it returned `cancel_pending` with a confidence of 0.50 — a coin flip.
3. **The reviewer had a hole.** GPT-4o was only called when the AI was "uncertain" or
   blocked a trade the rules parsed. `cancel_pending` counts as an executable answer,
   so a 50 % guess became final with no second opinion; `validateTradeIntent` has no
   confidence floor either.
4. **The executor then behaved correctly**: a cancel instruction that is not a reply
   cannot know which order to cancel, so it skipped with `delete_pendings_requires_reply`.
   The skip was honest — the misclassification upstream was the fault.
5. **Contributing:** Cerebras (stage-2 provider) was returning HTTP 402 "payment
   required" on both environments, so every parse silently fell back to OpenAI.

The same design hole produced the wider families listed above — notably 91 messages
in 30 days where `BUY LIMITS GOLD @ …` entry posts were read as cancellations and
thrown away (the same failure class as the documented 2026-09-19 incident).

## The fix

Four coordinated changes, written in plain terms:

1. **Confidence floor.** Any actionable AI answer below **70 %** certainty
   (`UNIVERSAL_PARSE_RECONCILE_MIN_CONF`, default 0.70, safely clamped) must go to
   the reviewer instead of being trusted as final.
2. **Four review triggers.** The reviewer now also runs when: (a) rules and AI
   disagree on what kind of message it is; (b) the AI flips a trade's direction;
   (c) the AI claims a cancellation the rules never confirmed; (d) any actionable
   answer is below the 70 % floor. Agreed, confident answers still skip the reviewer,
   so normal traffic is unaffected.
3. **Two hard rules in the AI's instructions** (stage 2 and stage 3): "close all /
   close everything / flatten" can only ever mean *close*, never a cancel; and a
   message that merely lists pending limit/stop entries with no cancel verb is an
   *entry*, never a cancellation.
4. **Standalone cancels act.** A parentless "cancel pending orders" now sweeps every
   resting pending order on the channel (broker-pending entries, resting LIMIT/STOP
   trades — each verified against the live broker list first — and range legs),
   respecting per-account channel filters, in bounded batches, with an honest
   "truncated" flag. Reply-scoped and order-linked cancels are unchanged.

Complementary (Planmoni/Martins, `5cd1580f`, already on staging): recognised
management phrases now bypass the AI entirely and use the rules result directly —
which closes the original incident at its source. Our triggers guard everything that
still reaches the AI.

## Files changed

- `worker/src/signalIntent/parseConfig.ts` — `universalParseReconcileMinConf()` (70 % floor)
- `worker/src/signalIntent/parseRouting.ts` — four new stage-3 triggers in `shouldReconcileSignal()`
- `worker/src/signalIntent/universalSignalParser.ts` — two hard prompt rules (stage 2 + stage 3)
- `worker/src/tradeExecutor/managementExecutor.ts` — channel-wide sweep for standalone `delete_pendings`
- `worker/src/signalIntent/parseRouting.test.ts` — 8 arbitration test cases (1 flipped)
- `worker/src/deletePendingsManagement.test.ts` — 2 channel-sweep tests + rebuilt DB mock

Commit: `871199a8` — "fix(worker): arbitrate conflicting AI parses and sweep channel pendings for standalone cancels".

## Verification

**Automated**
- `npm --prefix worker run build` (tsc): 0 errors.
- Targeted suite: **162/165** — the 3 failures are a separate workstream's repairs
  sitting in a stash (providerScope `is()` mock, managementClose ticket mock,
  virtualPendingMonitor overrides); unrelated to this change and import-disjoint.
- ESLint clean on all six files (one pre-existing, untouched warning elsewhere).

**Live on staging after deploy (via the in-house pipeline test tool)**

| Case | Result |
|---|---|
| `BUY LIMITS GOLD @ 3875/3873 AREA …` (the misread family) | **PASS** — parsed as a real entry, dispatched; broker refused only for market hours |
| `cancel pending orders` (standalone) | **PASS** — channel sweep ran: `delete_pendings_none`, `mgmt_scope: channel`, never `requires_reply` |
| `Close all trades now` (the incident message) | **PASS** — deterministic fast-lane, AI bypassed, correct close intent |
| BTCUSD entry (24/7 market) | **PASS** — opened, stops persisted, basket merge OK; closed in cleanup (0 open trades left) |
| French rules-unread cancel (forced arbitration) | **PASS** — stage 3 fired (`ai_source: gpt4o`), overruled stage 2, final decision by GPT-4o |
| Full pipeline suite | 4/5 — the single failure is a broker `MARKET_CLOSED` (gold rollover at test time), not code; re-run when the market reopens |

## Deployment status

- **Staging: deployed and verified.** Pushed to `upstream/staging` (tip `b37bda50`
  containing `871199a8`); Railway staging build **SUCCESS** at 2026-11-12 22:26 UTC;
  all live tests above ran against this build.
- **Production: not yet deployed.** Prod still runs the 2026-11-10 build (its deploy
  attempts on 11-11 were failing at the time of investigation). Promoting this fix to
  production is a separate, explicit decision.

## Follow-ups

1. Decide production promotion of this fix (and re-check why prod deploys were failing).
2. Turn on `HUMAN_REVIEW_ESCALATION_ENABLED` so `uncertain` results (298/week on prod)
   become approval prompts instead of silent skips — product decision.
3. Side-inference prompt rule: infer direction from TP/SL geometry when the message
   omits buy/sell (the 12-13 Nov `🔤🔤` case: identical format executed once and was
   skipped once purely from model variance).
4. Persist the `_verification` decision chain on the live ingest path (events show it
   ran; signal rows currently store `null` — observability gap).
5. Investigate the phantom `message_revision_applied` events that fire without a
   Telegram edit (no behavioural impact observed — stored intents stayed intact).
6. Cerebras billing (HTTP 402 on both environments) — restore or remove the provider
   so stage 2 stops silently falling back.
7. Re-run the pipeline suite when gold reopens for a clean 5/5.
