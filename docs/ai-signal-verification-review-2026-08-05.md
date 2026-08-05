# AI Signal Verification, False-Positive Protection, and Human Review

## Date

2026-08-05

## Purpose

This document records the implementation that adds AI verification to the Telegram signal parser without slowing down clean, high-confidence trades and without sending every AI rejection to a human.

The system handles real broker orders. The design therefore separates three different outcomes:

1. The message is clearly an executable trade.
2. The message is clearly not an executable trade.
3. The message cannot be classified safely and needs a human decision.

Only the third outcome enters human review.

## What was implemented previously

Before this change, the listener's effective production decision came from the deterministic parser.

The previous behavior was:

1. Telegram delivered a message to the listener.
2. The deterministic parser applied channel keywords, regexes, price patterns, and eligibility checks.
3. A high-confidence deterministic result dispatched directly to the trade worker.
4. A lower-confidence deterministic result also remained executable under the existing policy.
5. A deterministic skip ended as a skipped signal. The message was not sent to AI for trade recovery.
6. The universal AI parser ran in shadow mode by default, asynchronously observing messages and recording differences, but it could not change execution.
7. In the earlier fastpath implementation, AI was awaited for non-fastpath messages, but an AI skip/commentary result fell back to the deterministic parsed result. Therefore AI could not reliably veto a false positive.
8. There was no explicit AI `uncertain` result and no AI-specific human-review state.
9. Existing manual retry was limited to operational retry reasons such as broker disconnection or an entry not opening. It was not a controlled approval path for an AI-uncertain trade.

This explains both failure classes:

- Deterministic false negatives were silently skipped because AI was not asked to recover them.
- Deterministic false positives could execute because the AI was observational only or its non-actionable result fell back to the deterministic parse.
- Commentary protection did not cover every result/advisory form. In particular, `TP1+20PIPS` looked like a TP structure and `SL suggested` satisfied the labeled-stop logic.

### Previous versus current behavior

| Area | Previous implementation | Current implementation |
|---|---|---|
| Clear deterministic signal | Executed under deterministic policy | Executes immediately only at the `0.99` fast lane |
| Deterministic lower-confidence signal | Could execute without AI approval | Sent to AI first |
| Deterministic skip | Silently skipped | Sent immediately to AI for recovery |
| AI clear entry | Observed or used only in limited paths | Dispatches the AI parse |
| AI clear commentary/ignore | Could fall back to deterministic execution | Remains skipped without human review |
| AI uncertainty | No explicit state | Creates a review-required signal/event |
| AI outage | No explicit fallback audit | Deterministic policy continues and `ai_parse_fallback` is logged |
| Human approval safety | No AI-specific approval window or quote check | Two-minute window plus live entry-price validation |
| Result/advisory guard | Had gaps around result notation and suggested stops | Covers both word orders and multilingual result/advisory markers |

## Deterministic confidence scoring tables

The deterministic parser stores a numeric `confidence` on the parsed signal. These values are parser scores, not measured probabilities. They were assigned by parser branches and have not been calibrated against a labeled production dataset.

### Main deterministic parser scores

| Score | Parser branch or condition | Typical interpretation | Current routing |
|---:|---|---|---|
| `0.99` | Direct/simple signal with recognized direction, instrument, and executable price context, including a valid `NOW`/market-style structure | Clean structured entry candidate | Fast lane; dispatch immediately if execution eligibility also passes |
| `0.93` | Entry recognized from direction, instrument, and price evidence without the strongest direct structure | Parsed entry, but not clean enough for immediate bypass | Send to AI verification |
| `0.92` | Generic deterministic management message before a more specific management branch is selected | Management candidate with moderate deterministic evidence | Send to AI verification under the current `0.99` threshold |
| `0.91` | Parameter follow-up that explicitly requests re-entry | Re-entry candidate from a follow-up message | Send to AI verification |
| `0.90` | Symbol-less parameter follow-up classified as a modification | Management candidate with weaker evidence | Send to AI verification |
| `0.88` | Close-like message that also contains entry-like wording and requires ambiguity handling | Higher-risk mixed-intent candidate | Send to AI verification |
| `0` | No matching parser pattern, explicit ignore, or eligibility failure that converts the parse to ignore | Deterministic skip | Send to AI for possible recovery when fastpath is enabled |

### Specific deterministic management overrides

| Score | Condition in parser | Action |
|---:|---|---|
| `0.95` | Delete-pendings command | Delete pending orders after AI verification under the default `0.99` threshold |
| `0.95` | Close-worse-entries command | Close worse entries after AI verification under the default `0.99` threshold |
| `0.95` | Explicit SL/TP modification command | Modify existing trade parameters after AI verification under the default `0.99` threshold |

### Non-deterministic or normalization values

| Score | Source | Meaning |
|---:|---|---|
| Model-provided value, clamped to `0..1` | AI parser output | Informational model score; it is not trusted as calibrated probability by itself |
| `0.95` fallback | AI/legacy normalization when a model result has no numeric confidence | Default normalization value, not evidence that the message is clean |
| `1` | Internal ignore payload used for a normalized non-trade record | Sentinel value for an internal ignored payload; it does not make the message executable |

### Important scoring limitation

The `0.99` fast lane is a routing threshold, not proof that the deterministic parser is `99% accurate`. The production incidents demonstrate why: the deterministic parser previously assigned `0.93` to both false positives, and future false positives could theoretically receive any parser score if a new branch assigns that score. Staging metrics and labeled review outcomes are still required to validate the threshold.

## Production problems being addressed

### False positives

The deterministic parser previously executed commentary when commentary contained trade-shaped text.

Examples:

- A results recap containing `SELL HITS TP1+20PIPS` was interpreted as a new sell trade.
- Market analysis containing `SL suggested` was interpreted as an executable signal.

Both messages reached the broker execution path with deterministic confidence `0.93`.

### False negatives

Messages in unfamiliar channel formats were skipped by deterministic parsing. The AI already inspected messages in shadow mode, but its result could not recover a deterministic skip.

The new flow sends deterministic skips to the AI immediately when fastpath verification is enabled.

## Decision model

### Deterministic fast lane

If the deterministic parser produces an eligible result with confidence at least `0.99`, the listener dispatches it immediately. The AI does not delay this path.

This protects latency-sensitive `NOW` and market entries.

### AI verification lane

Every deterministic result below the fast-lane threshold, including deterministic skips, is sent to the universal AI parser.

The AI has three operational outcomes:

| AI outcome | System action | Human review |
|---|---|---|
| Clear `entry` or executable management action | Use the AI parse and dispatch through the existing execution pipeline | No |
| Clear `ignore` or `commentary` | Persist the signal as skipped | No |
| Explicit `uncertain` | Persist a reviewable skipped signal and emit a review-required event | Yes |

The AI prompt now explicitly instructs the model to use `uncertain` when a message could be a trade but the side, price, instruction, or intent is genuinely ambiguous.

An AI rejection is not automatically a review. Clear rejection remains a silent skip.

### AI unavailable or timed out

When OpenAI is unavailable, times out, returns no content, or cannot be used, the system preserves the existing deterministic policy:

- A deterministic fast-lane trade continues.
- An ambiguous deterministic result follows the existing deterministic outcome.
- A deterministic skip remains skipped.

The worker records an `ai_parse_fallback` listener event with the fallback reason. This identifies periods where AI false-positive protection was unavailable.

## End-to-end message flow

```text
Telegram message
      |
      v
Deterministic parser
      |
      +-- eligible and confidence >= 0.99 --> immediate dispatch
      |
      +-- anything else --> universal AI parser
                                      |
                                      +-- clear entry --> AI parse dispatch
                                      |
                                      +-- clear skip/commentary --> skipped
                                      |
                                      +-- uncertain --> review-required signal
                                      |
                                      +-- unavailable/timeout --> deterministic policy
```

All dispatches still pass through the existing signal persistence, duplicate protection, broker eligibility, execution, and range safeguards.

## Human review behavior

Human review applies only to a signal whose AI result is explicitly `uncertain`.

The existing signal/Copier Logs review and retry path is used. The worker also writes an `ai_parse_review_required` row to `listener_events` containing:

- Signal ID.
- Telegram message ID.
- AI intent and source.
- AI skip reason.
- `review_required: true`.

Clear AI commentary and ignore results do not emit this review-required event.

### Review expiry

The approval window is a fixed two minutes from the signal `created_at` timestamp:

```text
AI_REVIEW_MAX_AGE_MS = 120000
```

If the reviewer responds after that window, the retry path:

1. Refuses dispatch.
2. Updates the signal to `skipped`.
3. Stores `ai_review_expired` as the skip reason.

No new environment variable is required for this limit.

### Live-price requirement

Before a human-approved review is dispatched, the worker checks every matching active broker account.

The check requires:

- A valid parsed symbol.
- A valid entry price or entry zone.
- An active broker connected to the channel.
- A resolved broker symbol.
- Valid symbol parameters and pip size.
- A fresh broker quote.
- The current reference price to remain within the entry price or zone plus the broker's configured `signal_entry_pip_tolerance`.

For a buy, the ask is checked. For a sell, the bid is checked.

If any matching broker fails the check, the worker:

1. Refuses dispatch.
2. Updates the signal to `skipped`.
3. Stores `ai_review_price_passed` as the skip reason.

This prevents a reviewer from approving a stale signal after the market has moved away from its original entry.

The check is intentionally conservative. Missing quotes, missing symbol parameters, missing entries, or no matching active broker do not permit a review approval.

## Commentary protection

The worker and Supabase shared commentary guards now reject result, promotion, and advisory language before generic trade-shaped parsing can accept it.

Covered markers include:

- `RESULT` / `RESULTS`.
- `RECAP`.
- `PERFORMANCE`.
- `TOTAL PIPS`.
- `HITS TP1` and similar result language.
- `TP1+20PIPS` and equivalent TP result notation.
- `JOIN VIP` and VIP result/performance language.
- `suggested SL`.
- `SL suggested`.
- Arabic equivalents for results, performance, joining/promotional language, target hits, and suggested stops/targets.

The guard still allows a direct executable message such as:

```text
GOLD SELL NOW @4258 SL:4273
```

## Configuration

The implementation uses the existing parser settings plus one new switch.

```env
UNIVERSAL_PARSE_MODE=fastpath
UNIVERSAL_PARSE_FASTPATH_CONFIDENCE=0.99
UNIVERSAL_PARSE_AI_VETO_ENABLED=true
```

### Defaults

- The fastpath confidence default is now `0.99`.
- `UNIVERSAL_PARSE_AI_VETO_ENABLED` defaults to `false` for safe rollout.
- Existing AI model, timeout, and API settings are unchanged.

The veto switch controls whether AI results can replace the deterministic result in the verification lane. It does not affect the deterministic fast lane.

### Railway service placement

In the current split Railway deployment, these variables belong on the **listener service**:

```env
UNIVERSAL_PARSE_MODE=fastpath
UNIVERSAL_PARSE_FASTPATH_CONFIDENCE=0.99
UNIVERSAL_PARSE_AI_VETO_ENABLED=true
```

The listener receives Telegram messages, runs deterministic parsing, calls the AI parser, and decides whether a message is an entry, skip, or review candidate.

They do not need to be added to the separate trade worker. The trade worker receives dispatches and executes them. The updated worker code must still be deployed to both services because the trade worker contains the review approval expiry and broker-price checks.

For staging, configure the variables on the staging listener Railway service. Do not add them to `.env` or to the trade worker unless the deployment is later changed to a single process that performs both roles.

## Files changed

### Worker parser and AI routing

- `worker/src/signalIntent/tradeIntent.ts`
  - Adds the `uncertain` intent kind.
- `worker/src/signalIntent/coerceTradeIntent.ts`
  - Accepts `uncertain` from the AI response.
- `worker/src/signalIntent/tradeIntentAdapter.ts`
  - Preserves a reviewable buy/sell candidate when an uncertain AI result contains a side and entry.
- `worker/src/signalIntent/universalSignalParser.ts`
  - Documents `uncertain` in the AI prompt.
  - Preserves uncertain results as skipped and review-required.
- `worker/src/signalIntent/parseRouting.ts`
  - Keeps the immediate deterministic fast lane.
  - Sends all other messages, including deterministic skips, to AI.
  - Separates clear skip from explicit uncertainty.
- `worker/src/signalIntent/parseConfig.ts`
  - Changes the default fast-lane threshold to `0.99`.
  - Adds the existing-style boolean switch for AI veto/review behavior.

### Commentary protection

- `worker/src/signalCommentaryGuard.ts`
- `supabase/functions/_shared/signalCommentaryGuard.ts`

Both parser environments receive the same result/advisory protection.

### Review and observability

- `worker/src/userListener.ts`
  - Persists AI fallback and review-required events.
- `worker/src/listenerEvents.ts`
  - Registers `ai_parse_fallback` and `ai_parse_review_required` event types.
- `worker/src/retrySignal.ts`
  - Adds the two-minute review window.
  - Checks live broker prices before approval dispatch.
  - Expires stale or price-passed reviews.
- `src/lib/retrySignalDisplay.ts`
  - Makes AI-uncertain signals retry/approval eligible in Copier Logs.
- `src/lib/copierSkipReasonLabels.ts`
  - Adds display labels for AI review and expiry outcomes.

### Tests

- `worker/src/signalCommentaryGuard.test.ts`
  - Covers the results recap, `SL suggested`, and valid direct signal examples.
- `worker/src/retrySignal.test.ts`
  - Covers the review window and review retry reason.
- Existing parser routing and intent validation tests were run with the new behavior.

### Project memory

- `docs/PROJECT_MEMORY.md`
  - Contains the persistent summary of the implementation and verification.

## Database impact

No database migration was added.

The implementation uses existing tables and paths:

- `signals` for the parsed/skipped signal and review retry state.
- `listener_events` for AI fallback and review-required audit events.
- Existing Copier Logs and retry-signal approval flow.

No new table, column, index, or database function is required.

## Rollout procedure

### Staging

1. Deploy the worker and frontend changes to staging.
2. Set fastpath mode, the `0.99` threshold, and the AI veto switch.
3. Confirm a clean labeled signal executes without waiting for AI.
4. Confirm a deterministic false negative is recovered by AI.
5. Confirm a clear AI commentary result is skipped without a review alert.
6. Confirm an explicit AI uncertainty appears in Copier Logs and creates `ai_parse_review_required`.
7. Approve within two minutes while price is inside the entry range.
8. Confirm approval after two minutes is rejected as `ai_review_expired`.
9. Move price outside the permitted entry range and confirm approval is rejected as `ai_review_price_passed`.
10. Simulate AI timeout/unavailability and confirm deterministic fallback plus `ai_parse_fallback` logging.
11. Test both English and Arabic commentary examples.

### Production

Enable the same settings only after staging confirms the above cases and confirms no duplicate broker execution.

## Operational properties

### Latency

- Fast-lane trades do not wait for AI.
- Non-fastpath messages wait for the configured existing AI timeout.
- Human review is never part of the live message-to-broker latency path; it is a separate approval action.

### Duplicate execution

The change does not replace the existing signal persistence or broker dispatch idempotency controls. Human approval uses the existing retry dispatch path, which continues to use the signal identity and executor duplicate checks.

### Review volume

Review volume is limited to AI responses explicitly classified as `uncertain`. Clear AI skips remain silent skips.

### Failure policy

The implementation is fail-open for AI availability, as requested: when AI is unavailable, deterministic behavior continues. The event log makes that degraded protection visible for later audit.

## Known limitations

1. AI self-reported confidence is not treated as a calibrated probability. The safety decision is based on the AI intent category and deterministic eligibility, not confidence alone.
2. The review price check requires valid broker quote and symbol-parameter data. Missing market data rejects approval rather than approving blindly.
3. The two-minute window is intentionally fixed in code to avoid adding another environment variable. Changing it requires a code change and redeployment.
4. The review mechanism reuses the existing Copier Logs/retry path. This implementation does not create a separate review queue table or a new push-notification channel.
5. Staging must validate the real AI response distribution before production enablement.

## Verification performed

The following checks passed:

```text
npx tsc -p worker/tsconfig.json --noEmit
npx tsc -b --noEmit
node --import tsx --test \
  src/signalCommentaryGuard.test.ts \
  src/retrySignal.test.ts \
  src/signalIntent/parseRouting.test.ts \
  src/signalIntent/validateTradeIntent.test.ts
```

Result: 4 test files passed, 0 failures.

`git diff --check` also passed for the affected files.
