"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeSignalParse = routeSignalParse;
exports.logShadowDiff = logShadowDiff;
const parseConfig_1 = require("./parseConfig");
const shadowDiff_1 = require("./shadowDiff");
const universalSignalParser_1 = require("./universalSignalParser");
async function routeSignalParse(args) {
    const mode = (0, parseConfig_1.getUniversalParseMode)();
    const det = (0, universalSignalParser_1.parseDeterministicForUniversal)(args.rawMessage, args.keywords, args.lexicon, args.isModificationClass);
    const runUniversal = () => (0, universalSignalParser_1.parseUniversalSignal)(args.supabase, {
        userId: args.userId,
        channelRowId: args.channelRowId,
        rawMessage: args.rawMessage,
        isReply: args.isReply,
        parentSignalId: args.parentSignalId,
        revision: args.revision,
    });
    if (mode === 'off') {
        return { parseResult: det };
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
        return { parseResult: det };
    }
    const fastPathOk = (0, universalSignalParser_1.deterministicQualifiesForFastPath)(det, args.rawMessage, args.keywords);
    if (mode === 'fastpath' && fastPathOk) {
        return { parseResult: det, aiMeta: { intent: String(det.parsed.action), source: 'deterministic' } };
    }
    if (mode === 'fastpath' && !fastPathOk) {
        const universal = await runUniversal();
        if (universal.parseResult.status === 'parsed') {
            return {
                parseResult: universal.parseResult,
                aiMeta: { intent: universal.intent.kind, source: universal.source },
                universalIntent: universal.intent,
            };
        }
        return {
            parseResult: det.status === 'parsed' ? det : universal.parseResult,
            aiMeta: { intent: universal.intent.kind, source: universal.source },
            universalIntent: universal.intent,
        };
    }
    // primary: universal first, deterministic fallback when AI unavailable
    const universal = await runUniversal();
    if (universal.parseResult.status === 'parsed') {
        return {
            parseResult: universal.parseResult,
            aiMeta: { intent: universal.intent.kind, source: universal.source },
            universalIntent: universal.intent,
        };
    }
    if (universal.skip_reason === 'universal_parse_unavailable' || universal.source === 'unavailable') {
        return {
            parseResult: det,
            aiMeta: { intent: 'deterministic_fallback', source: 'deterministic' },
        };
    }
    return {
        parseResult: universal.parseResult,
        aiMeta: { intent: universal.intent.kind, source: universal.source },
        universalIntent: universal.intent,
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
