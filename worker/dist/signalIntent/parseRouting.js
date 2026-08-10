"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniversalParseMode = void 0;
exports.buildVerificationChain = buildVerificationChain;
exports.shouldReconcileSignal = shouldReconcileSignal;
exports.routeSignalParse = routeSignalParse;
exports.logShadowDiff = logShadowDiff;
const pipelineTimestamps_1 = require("../pipelineTimestamps");
const parseConfig_1 = require("./parseConfig");
Object.defineProperty(exports, "getUniversalParseMode", { enumerable: true, get: function () { return parseConfig_1.getUniversalParseMode; } });
const shadowDiff_1 = require("./shadowDiff");
const tradeIntentAdapter_1 = require("./tradeIntentAdapter");
const signalModificationGrounding_1 = require("../signalModificationGrounding");
const universalSignalParser_1 = require("./universalSignalParser");
function detStage(det) {
    return {
        source: 'deterministic',
        kind: String(det.parsed.action ?? '').toLowerCase(),
        symbol: det.parsed.symbol ?? null,
        confidence: typeof det.parsed.confidence === 'number' ? det.parsed.confidence : null,
        status: det.status,
        skip_reason: det.skip_reason ?? null,
    };
}
function stageFromResult(r, source) {
    if (!r)
        return null;
    return {
        source,
        kind: r.intent.kind,
        side: r.intent.side ?? null,
        symbol: r.intent.symbol ?? null,
        confidence: r.intent.confidence ?? null,
        status: r.parseResult.status,
        skip_reason: r.skip_reason ?? null,
    };
}
/** Build the full decision chain for a routed outcome. */
function buildVerificationChain(args) {
    const t = args.timings;
    const s2 = args.universal && args.universal.source !== 'unavailable'
        ? stageFromResult(args.universal, args.universal.source)
        : null;
    const s3 = args.reconciled ? stageFromResult(args.reconciled, 'gpt4o') : null;
    return {
        deterministic: {
            ...detStage(args.det),
            duration_ms: t?.deterministic_ms ?? null,
        },
        stage2: s2 ? { ...s2, duration_ms: t?.stage2_ms ?? null } : null,
        stage3: s3 ? { ...s3, duration_ms: t?.stage3_ms ?? null } : null,
        final: {
            path: args.path,
            source: args.finalSource,
            kind: args.finalKind,
            skip_reason: args.finalSkipReason ?? null,
        },
    };
}
const EXECUTABLE_KINDS = new Set([
    'entry', 'modify', 'close', 'breakeven', 'partial_close', 'cancel_pending',
]);
const MODIFICATION_KINDS = new Set([
    'modify', 'close', 'breakeven', 'partial_close',
]);
function groundingSkipResult(rawMessage, reason, source) {
    const intent = {
        kind: 'ignore',
        side: null,
        symbol: null,
        entry: [],
        sl: null,
        tp: [],
        sl_unit: 'price',
        tp_unit: 'price',
        flags: {},
        confidence: 0,
    };
    return {
        intent,
        source,
        skip_reason: reason,
        parseResult: {
            parsed: (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, rawMessage),
            status: 'skipped',
            skip_reason: reason,
        },
    };
}
/**
 * Modification grounding: an SL/TP modification must target the user's OPEN
 * trade for this channel, and — when the message is a Telegram reply — must
 * match the parent signal's symbol (the channel told us which trade it means).
 *
 * Reply-based symbol enforcement:
 * - parent symbol known + model omitted the symbol → fill with the parent's.
 * - parent symbol known + model contradicts it → forced GPT-4o reconciliation;
 *   GPT-4o must match the parent or the modification is skipped.
 * - no parent → model symbol is judged against open trades only.
 *
 * Open-trade grounding:
 * - no open trades at all → stale modification, skip.
 * - open trades exist but the symbol misses → forced GPT-4o reconciliation
 *   with the open-trade list; GPT-4o's result must also hit an open trade.
 *
 * Query failure returns null → fail open, normal flow continues (the trade
 * worker merge only modifies open baskets anyway).
 */
async function groundModificationResult(args) {
    const { universal } = args;
    if (universal.parseResult.status !== 'parsed' || !MODIFICATION_KINDS.has(universal.intent.kind)) {
        return null;
    }
    const [openTrades, parentSymbol] = await Promise.all([
        (0, signalModificationGrounding_1.loadOpenTradesForChannel)(args.supabase, {
            userId: args.userId,
            channelRowId: args.channelRowId,
        }),
        (0, signalModificationGrounding_1.loadParentSignalSymbol)(args.supabase, args.parentSignalId),
    ]);
    if (openTrades === null)
        return null;
    // Reply-based enforcement: the parent's symbol is ground truth.
    let grounded = universal;
    const parentResolution = (0, signalModificationGrounding_1.resolveModificationParentSymbol)({
        parentSymbol,
        modelSymbol: universal.intent.symbol ?? null,
    });
    if (parentResolution.kind === 'fill') {
        grounded = withIntentSymbol(universal, parentResolution.symbol);
    }
    else if (parentResolution.kind === 'conflict') {
        if (!(0, parseConfig_1.universalParseReconcileEnabled)()) {
            return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, universal.source);
        }
        const reconciled = await (0, universalSignalParser_1.reconcileUniversalSignal)(args.supabase, {
            userId: args.userId,
            channelRowId: args.channelRowId,
            rawMessage: args.rawMessage,
            isReply: args.isReply,
            parentSignalId: args.parentSignalId,
            revision: args.revision,
            isModificationClass: args.isModificationClass,
        }, {
            deterministic: args.det,
            stage2: universal,
            reason: `modification_parent_symbol_conflict:${parentResolution.modelSymbol}`,
            openTrades,
        });
        if (reconciled.source !== 'gpt4o') {
            return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, universal.source);
        }
        const reconciledResolution = (0, signalModificationGrounding_1.resolveModificationParentSymbol)({
            parentSymbol,
            modelSymbol: reconciled.intent.symbol ?? null,
        });
        if (reconciled.parseResult.status !== 'parsed'
            || !MODIFICATION_KINDS.has(reconciled.intent.kind)
            || reconciledResolution.kind !== 'ok') {
            return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, 'gpt4o');
        }
        grounded = reconciled;
    }
    if (openTrades.length === 0) {
        return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source);
    }
    if ((0, signalModificationGrounding_1.modificationTargetsOpenTrade)(grounded.intent, openTrades))
        return null;
    if (!(0, parseConfig_1.universalParseReconcileEnabled)()) {
        return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source);
    }
    const reconciled = await (0, universalSignalParser_1.reconcileUniversalSignal)(args.supabase, {
        userId: args.userId,
        channelRowId: args.channelRowId,
        rawMessage: args.rawMessage,
        isReply: args.isReply,
        parentSignalId: args.parentSignalId,
        revision: args.revision,
        isModificationClass: args.isModificationClass,
    }, {
        deterministic: args.det,
        stage2: grounded,
        reason: `modification_target_not_open:${grounded.intent.symbol ?? 'null'}`,
        openTrades,
    });
    if (reconciled.source !== 'gpt4o') {
        return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source);
    }
    if (reconciled.parseResult.status === 'parsed'
        && MODIFICATION_KINDS.has(reconciled.intent.kind)
        && !(0, signalModificationGrounding_1.modificationTargetsOpenTrade)(reconciled.intent, openTrades)) {
        return groundingSkipResult(args.rawMessage, signalModificationGrounding_1.MODIFICATION_NO_OPEN_TRADE_REASON, 'gpt4o');
    }
    return reconciled;
}
/** Copy a universal result with a forced symbol on both the intent and parsed signal. */
function withIntentSymbol(result, symbol) {
    return {
        ...result,
        intent: { ...result.intent, symbol },
        parseResult: {
            ...result.parseResult,
            parsed: {
                ...result.parseResult.parsed,
                symbol,
            },
        },
    };
}
/**
 * Stage 3 trigger (Option 1): GPT-4o reconciliation runs only when stage 2
 * (OSS) is uncertain, when the hallucination guard rejected stage 2's prices,
 * or when stage 2 blocks a trade the deterministic parser found. OSS-confirmed
 * and OSS-recovered results are trusted without the final model.
 */
function shouldReconcileSignal(det, universal) {
    if (universal.source === 'unavailable')
        return false;
    if (universal.intent.kind === 'uncertain')
        return true;
    if (universal.skip_reason?.startsWith('intent_validation_failed') === true
        || universal.skip_reason === 'entry_missing_side') {
        return true;
    }
    const detParsed = det.status === 'parsed' && det.parsed.action !== 'ignore';
    const uniExecutable = EXECUTABLE_KINDS.has(universal.intent.kind);
    return detParsed && !uniExecutable;
}
function routeStageThreeResult(reconciled, det, chain) {
    const finalSource = reconciled.source;
    const base = {
        parseResult: reconciled.parseResult,
        universalIntent: reconciled.intent,
        verification: buildVerificationChain({
            det,
            timings: chain.timings,
            universal: chain.universal,
            reconciled,
            path: chain.path,
            finalSource,
            finalKind: reconciled.intent.kind,
            finalSkipReason: reconciled.parseResult.skip_reason ?? null,
        }),
    };
    if (reconciled.parseResult.status === 'parsed') {
        return {
            ...base,
            aiMeta: { intent: reconciled.intent.kind, source: reconciled.source },
        };
    }
    if (reconciled.intent.kind === 'uncertain') {
        return {
            ...base,
            aiMeta: {
                intent: 'uncertain',
                source: reconciled.source,
                reviewRequired: true,
            },
        };
    }
    if ((0, parseConfig_1.universalParseAiVetoEnabled)()) {
        return {
            ...base,
            aiMeta: { intent: reconciled.intent.kind, source: reconciled.source },
        };
    }
    return {
        parseResult: det.status === 'parsed' ? det : reconciled.parseResult,
        aiMeta: {
            intent: reconciled.intent.kind,
            source: reconciled.source,
            fallbackReason: 'ai_veto_disabled',
        },
        universalIntent: reconciled.intent,
        verification: buildVerificationChain({
            det,
            timings: chain.timings,
            universal: chain.universal,
            reconciled,
            path: 'veto_disabled',
            finalSource: 'deterministic',
            finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
            finalSkipReason: null,
        }),
    };
}
async function runStageThree(args) {
    if (!(0, parseConfig_1.universalParseReconcileEnabled)())
        return null;
    if (!shouldReconcileSignal(args.det, args.universal))
        return null;
    const stamp = (key) => {
        if (args.pipelineTs)
            (0, pipelineTimestamps_1.setPipelineTimestamp)(args.pipelineTs, key, Date.now());
    };
    stamp('t_stage3_started_at');
    const reconciled = await (0, universalSignalParser_1.reconcileUniversalSignal)(args.supabase, {
        userId: args.userId,
        channelRowId: args.channelRowId,
        rawMessage: args.rawMessage,
        isReply: args.isReply,
        parentSignalId: args.parentSignalId,
        revision: args.revision,
        isModificationClass: args.isModificationClass,
    }, {
        deterministic: args.det,
        stage2: args.universal,
        reason: args.universal.skip_reason ?? null,
    });
    stamp('t_stage3_done_at');
    const s3Start = args.pipelineTs?.t_stage3_started_at;
    const s3Done = args.pipelineTs?.t_stage3_done_at;
    if (args.timings && typeof s3Start === 'number' && typeof s3Done === 'number') {
        args.timings.stage3_ms = Math.max(0, s3Done - s3Start);
    }
    return reconciled.source === 'gpt4o' ? reconciled : null;
}
async function routeSignalParse(args) {
    const mode = (0, parseConfig_1.getUniversalParseMode)();
    const timings = {
        deterministic_ms: null,
        stage2_ms: null,
        stage3_ms: null,
    };
    const stamp = (key) => {
        if (args.pipelineTs)
            (0, pipelineTimestamps_1.setPipelineTimestamp)(args.pipelineTs, key, Date.now());
    };
    stamp('t_stage1_started_at');
    const det = (0, universalSignalParser_1.parseDeterministicForUniversal)(args.rawMessage, args.keywords, args.lexicon, args.isModificationClass);
    stamp('t_stage1_done_at');
    timings.deterministic_ms = null; // exact duration filled below from stamps
    const stage1Start = args.pipelineTs?.t_stage1_started_at;
    const stage1Done = args.pipelineTs?.t_stage1_done_at;
    if (typeof stage1Start === 'number' && typeof stage1Done === 'number') {
        timings.deterministic_ms = Math.max(0, stage1Done - stage1Start);
    }
    const runUniversal = async () => {
        stamp('t_stage2_started_at');
        const r = await (0, universalSignalParser_1.parseUniversalSignal)(args.supabase, {
            userId: args.userId,
            channelRowId: args.channelRowId,
            rawMessage: args.rawMessage,
            isReply: args.isReply,
            parentSignalId: args.parentSignalId,
            revision: args.revision,
            isModificationClass: args.isModificationClass,
        });
        stamp('t_stage2_done_at');
        const s2Start = args.pipelineTs?.t_stage2_started_at;
        const s2Done = args.pipelineTs?.t_stage2_done_at;
        if (typeof s2Start === 'number' && typeof s2Done === 'number') {
            timings.stage2_ms = Math.max(0, s2Done - s2Start);
        }
        return r;
    };
    if (mode === 'off') {
        return {
            parseResult: det,
            verification: buildVerificationChain({
                det,
                timings,
                universal: null,
                reconciled: null,
                path: 'no_ai',
                finalSource: 'deterministic',
                finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
                finalSkipReason: det.skip_reason ?? null,
            }),
        };
    }
    if (mode === 'shadow') {
        void runUniversal()
            .then(universal => logShadowDiff(args.supabase, {
            userId: args.userId,
            signalId: args.signalId,
            channelRowId: args.channelRowId,
            deterministic: det,
            universal,
        }))
            .catch(() => undefined);
        return {
            parseResult: det,
            verification: buildVerificationChain({
                det,
                timings,
                universal: null,
                reconciled: null,
                path: 'shadow',
                finalSource: 'deterministic',
                finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
                finalSkipReason: det.skip_reason ?? null,
            }),
        };
    }
    const fastPathOk = (0, universalSignalParser_1.deterministicQualifiesForFastPath)(det, args.rawMessage, args.keywords);
    if (mode === 'fastpath' && fastPathOk) {
        return {
            parseResult: det,
            aiMeta: { intent: String(det.parsed.action), source: 'deterministic' },
            verification: buildVerificationChain({
                det,
                timings,
                universal: null,
                reconciled: null,
                path: 'fast_lane',
                finalSource: 'deterministic',
                finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
                finalSkipReason: null,
            }),
        };
    }
    if (mode === 'fastpath' && !fastPathOk) {
        const universal = await runUniversal();
        const aiUnavailable = universal.source === 'unavailable'
            || universal.skip_reason === 'universal_parse_unavailable';
        // Modification grounding: SL/TP changes must target an open trade in the
        // channel. Runs before the stage-3 triggers so a wrong-symbol modification
        // is either re-grounded by GPT-4o or skipped instead of dispatching to a
        // closed or unrelated trade.
        if (!aiUnavailable) {
            const grounded = await groundModificationResult({
                supabase: args.supabase,
                userId: args.userId,
                channelRowId: args.channelRowId,
                rawMessage: args.rawMessage,
                isReply: args.isReply,
                parentSignalId: args.parentSignalId,
                isModificationClass: args.isModificationClass,
                revision: args.revision,
                det,
                universal,
            });
            if (grounded) {
                if (grounded.source === 'gpt4o')
                    return routeStageThreeResult(grounded, det, { universal, path: 'stage3', timings });
                return {
                    parseResult: grounded.parseResult,
                    aiMeta: {
                        intent: grounded.intent.kind,
                        source: grounded.source,
                        fallbackReason: grounded.skip_reason ?? undefined,
                    },
                    universalIntent: grounded.intent,
                    verification: buildVerificationChain({
                        det,
                        timings,
                        universal,
                        reconciled: null,
                        path: 'grounding_skip',
                        finalSource: grounded.source,
                        finalKind: 'ignore',
                        finalSkipReason: grounded.skip_reason ?? null,
                    }),
                };
            }
        }
        // Stage 3 (GPT-4o) reconciliation: runs before the stage-2 early return so
        // a stage-2 recovery of a deterministic skip or a validation failure is
        // adjudicated by the final model instead of dispatching or skipping blindly.
        if (!aiUnavailable) {
            const reconciled = await runStageThree({
                supabase: args.supabase,
                userId: args.userId,
                channelRowId: args.channelRowId,
                signalId: args.signalId,
                rawMessage: args.rawMessage,
                isReply: args.isReply,
                parentSignalId: args.parentSignalId,
                isModificationClass: args.isModificationClass,
                revision: args.revision,
                det,
                universal,
                pipelineTs: args.pipelineTs,
                timings,
            });
            if (reconciled) {
                return routeStageThreeResult(reconciled, det, { universal, path: 'stage3', timings });
            }
        }
        if (universal.parseResult.status === 'parsed') {
            return {
                parseResult: universal.parseResult,
                aiMeta: {
                    intent: universal.intent.kind,
                    source: universal.source,
                    fallbackReason: universal.fallback_reason ?? undefined,
                },
                universalIntent: universal.intent,
                verification: buildVerificationChain({
                    det,
                    timings,
                    universal,
                    reconciled: null,
                    path: 'stage2',
                    finalSource: universal.source,
                    finalKind: universal.intent.kind,
                    finalSkipReason: null,
                }),
            };
        }
        if (aiUnavailable) {
            return {
                parseResult: det,
                aiMeta: {
                    intent: 'deterministic_fallback',
                    source: 'deterministic',
                    fallbackReason: universal.skip_reason ?? 'universal_parse_unavailable',
                },
                universalIntent: universal.intent,
                verification: buildVerificationChain({
                    det,
                    timings,
                    universal: null,
                    reconciled: null,
                    path: 'deterministic_fallback',
                    finalSource: 'deterministic',
                    finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
                    finalSkipReason: universal.skip_reason ?? null,
                }),
            };
        }
        // Only an explicit uncertain result enters human review. Clear commentary
        // and ignore results are ordinary skips and must not create review spam.
        if ((0, parseConfig_1.universalParseAiVetoEnabled)()) {
            return {
                parseResult: universal.parseResult,
                aiMeta: {
                    intent: universal.intent.kind,
                    source: universal.source,
                    fallbackReason: universal.fallback_reason ?? undefined,
                    reviewRequired: universal.intent.kind === 'uncertain',
                },
                universalIntent: universal.intent,
                verification: buildVerificationChain({
                    det,
                    timings,
                    universal,
                    reconciled: null,
                    path: universal.intent.kind === 'uncertain' ? 'review' : 'stage2_veto',
                    finalSource: universal.source,
                    finalKind: universal.intent.kind,
                    finalSkipReason: universal.parseResult.skip_reason ?? null,
                }),
            };
        }
        return {
            parseResult: det.status === 'parsed' ? det : universal.parseResult,
            aiMeta: {
                intent: universal.intent.kind,
                source: universal.source,
                fallbackReason: 'ai_veto_disabled',
            },
            universalIntent: universal.intent,
            verification: buildVerificationChain({
                det,
                timings,
                universal,
                reconciled: null,
                path: 'veto_disabled',
                finalSource: det.status === 'parsed' ? 'deterministic' : universal.source,
                finalKind: det.status === 'parsed'
                    ? String(det.parsed.action ?? 'ignore').toLowerCase()
                    : universal.intent.kind,
                finalSkipReason: universal.parseResult.skip_reason ?? null,
            }),
        };
    }
    // primary: universal first, deterministic fallback when AI unavailable
    const universal = await runUniversal();
    const aiUnavailable = universal.source === 'unavailable'
        || universal.skip_reason === 'universal_parse_unavailable';
    if (!aiUnavailable) {
        const grounded = await groundModificationResult({
            supabase: args.supabase,
            userId: args.userId,
            channelRowId: args.channelRowId,
            rawMessage: args.rawMessage,
            isReply: args.isReply,
            parentSignalId: args.parentSignalId,
            isModificationClass: args.isModificationClass,
            revision: args.revision,
            det,
            universal,
        });
        if (grounded) {
            if (grounded.source === 'gpt4o')
                return routeStageThreeResult(grounded, det, { universal, path: 'stage3', timings });
            return {
                parseResult: grounded.parseResult,
                aiMeta: {
                    intent: grounded.intent.kind,
                    source: grounded.source,
                    fallbackReason: grounded.skip_reason ?? undefined,
                },
                universalIntent: grounded.intent,
                verification: buildVerificationChain({
                    det,
                    timings,
                    universal,
                    reconciled: null,
                    path: 'grounding_skip',
                    finalSource: grounded.source,
                    finalKind: 'ignore',
                    finalSkipReason: grounded.skip_reason ?? null,
                }),
            };
        }
        const reconciled = await runStageThree({
            supabase: args.supabase,
            userId: args.userId,
            channelRowId: args.channelRowId,
            signalId: args.signalId,
            rawMessage: args.rawMessage,
            isReply: args.isReply,
            parentSignalId: args.parentSignalId,
            isModificationClass: args.isModificationClass,
            revision: args.revision,
            det,
            universal,
            pipelineTs: args.pipelineTs,
            timings,
        });
        if (reconciled)
            return routeStageThreeResult(reconciled, det, { universal, path: 'stage3', timings });
    }
    if (universal.parseResult.status === 'parsed') {
        return {
            parseResult: universal.parseResult,
            aiMeta: {
                intent: universal.intent.kind,
                source: universal.source,
                fallbackReason: universal.fallback_reason ?? undefined,
            },
            universalIntent: universal.intent,
            verification: buildVerificationChain({
                det,
                timings,
                universal,
                reconciled: null,
                path: 'stage2',
                finalSource: universal.source,
                finalKind: universal.intent.kind,
                finalSkipReason: null,
            }),
        };
    }
    if (aiUnavailable) {
        return {
            parseResult: det,
            aiMeta: { intent: 'deterministic_fallback', source: 'deterministic' },
            verification: buildVerificationChain({
                det,
                timings,
                universal: null,
                reconciled: null,
                path: 'deterministic_fallback',
                finalSource: 'deterministic',
                finalKind: String(det.parsed.action ?? 'ignore').toLowerCase(),
                finalSkipReason: universal.skip_reason ?? null,
            }),
        };
    }
    return {
        parseResult: universal.parseResult,
        aiMeta: {
            intent: universal.intent.kind,
            source: universal.source,
            fallbackReason: universal.fallback_reason ?? undefined,
        },
        universalIntent: universal.intent,
        verification: buildVerificationChain({
            det,
            timings,
            universal,
            reconciled: null,
            path: universal.intent.kind === 'uncertain' ? 'review' : 'stage2_veto',
            finalSource: universal.source,
            finalKind: universal.intent.kind,
            finalSkipReason: universal.parseResult.skip_reason ?? null,
        }),
    };
}
async function logShadowDiff(supabase, args) {
    const diff = (0, shadowDiff_1.compareParseShadowDiff)(args.deterministic, args.universal.parseResult);
    if (!diff.differs)
        return;
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: args.userId,
            signal_id: args.signalId,
            action: 'parse_shadow_diff',
            status: 'skipped',
            request_payload: {
                channel_id: args.channelRowId,
                ...diff,
                universal_kind: args.universal.intent.kind,
                universal_source: args.universal.source,
            },
        });
    }
    catch {
        // best-effort
    }
}
