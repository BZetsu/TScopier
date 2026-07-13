"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUniversalParseContext = buildUniversalParseContext;
exports.parseUniversalSignal = parseUniversalSignal;
exports.parseDeterministicForUniversal = parseDeterministicForUniversal;
exports.deterministicQualifiesForFastPath = deterministicQualifiesForFastPath;
exports.universalResultToParseResult = universalResultToParseResult;
const parseSignal_1 = require("../parseSignal");
const channelKeywordsCache_1 = require("../channelKeywordsCache");
const aiParseModification_1 = require("../aiParseModification");
const aiParseModification_2 = require("../aiParseModification");
const aiParseEntry_1 = require("../aiParseEntry");
const signalExecutionEligibility_1 = require("../signalExecutionEligibility");
const tradeSignalActions_1 = require("../tradeSignalActions");
const coerceTradeIntent_1 = require("./coerceTradeIntent");
const loadChannelExamples_1 = require("./loadChannelExamples");
const parseConfig_1 = require("./parseConfig");
const tradeIntentAdapter_1 = require("./tradeIntentAdapter");
const validateTradeIntent_1 = require("./validateTradeIntent");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const UNIVERSAL_SYSTEM_PROMPT = `You extract trading intent from Telegram channel messages in ANY language.
Return strict JSON only matching this schema:
{
  "kind": "entry" | "modify" | "close" | "breakeven" | "partial_close" | "ignore" | "commentary",
  "side": "BUY" | "SELL" | null,
  "symbol": string | null,
  "entry": number[],
  "sl": number | null,
  "tp": number[],
  "sl_unit": "price" | "pips",
  "tp_unit": "price" | "pips",
  "flags": {
    "market_now": boolean,
    "re_enter": boolean,
    "open_tp": boolean,
    "partial_close_fraction": number | null
  },
  "confidence": number,
  "detected_language": string | null
}
Rules:
- Extract TRADING INTENT, never translate the message literally.
- Map instrument aliases: GOLD, OR, XAU-USD, XAU/USD → XAUUSD; SILVER → XAGUSD.
- Never invent prices not present in the message.
- New trade entries: kind entry, side BUY or SELL, entry as [price] or zone [low, high].
- SL/TP updates on open trades: kind modify (keep side from parent/recent context when omitted).
- Full close: kind close. Move SL to entry: kind breakeven. Partial close: kind partial_close.
- TP-hit announcements, status updates, "TP2 reached", ATUALIZAÇÃO without new entry → kind commentary or ignore.
- Conditional tense, retrospective discussion, macro news → kind commentary.
- confidence 0-1.`;
function keywordsSummary(keywords) {
    return {
        skip: keywords.additional.skip_keyword,
        ignore: keywords.additional.ignore_keyword,
        entry: keywords.signal.entry_point,
        buy: keywords.signal.buy,
        sell: keywords.signal.sell,
        sl: keywords.signal.sl,
        tp: keywords.signal.tp,
        market: keywords.signal.market_order,
    };
}
async function callOpenAiUniversal(context) {
    if (!OPENAI_API_KEY) {
        return { raw: null, error: 'OPENAI_API_KEY not set on listener worker' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (0, parseConfig_1.universalParseTimeoutMs)());
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: (0, parseConfig_1.universalParseModel)(),
                temperature: 0,
                max_tokens: 500,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: UNIVERSAL_SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(context) },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { raw: null, error: `OpenAI HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        if (!content)
            return { raw: null, error: 'empty OpenAI response' };
        return { raw: JSON.parse(content), error: null };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            raw: null,
            error: msg.includes('abort') ? `OpenAI timeout after ${(0, parseConfig_1.universalParseTimeoutMs)()}ms` : msg,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function intentToLegacyParsed(intent, rawMessage, channelKeywords) {
    let parsed = (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, rawMessage);
    if (intent.kind === 'entry' && (parsed.action === 'buy' || parsed.action === 'sell')) {
        parsed = (0, aiParseEntry_1.coerceAiEntrySignal)(parsed);
    }
    if (intent.kind === 'modify') {
        parsed = (0, aiParseModification_2.coerceMgmtSlTpFollowUpAction)(parsed, 'modify');
    }
    return (0, parseSignal_1.enrichParsedKeywordMatch)(parsed, rawMessage, channelKeywords);
}
function buildSkipResult(rawMessage, skipReason) {
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
        source: 'unavailable',
        skip_reason: skipReason,
        parseResult: {
            parsed: (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, rawMessage),
            status: 'skipped',
            skip_reason: skipReason,
        },
    };
}
async function buildUniversalParseContext(supabase, args) {
    const { keywords } = await (0, channelKeywordsCache_1.getChannelParseContext)(supabase, args.channelRowId);
    const [base, examples] = await Promise.all([
        (0, aiParseModification_1.buildAiModificationContext)(supabase, {
            userId: args.userId,
            channelRowId: args.channelRowId,
            rawMessage: args.rawMessage,
            isReply: args.isReply,
            parentSignalId: args.parentSignalId,
            revision: args.revision,
        }),
        (0, loadChannelExamples_1.loadChannelSignalExamples)(supabase, args.channelRowId),
    ]);
    return {
        ...base,
        channel_keywords_summary: keywordsSummary(keywords),
        channel_examples: (0, loadChannelExamples_1.formatExamplesForPrompt)(examples),
    };
}
async function parseUniversalSignal(supabase, args) {
    if (!(0, parseConfig_1.isUniversalParseEnabled)() || (0, parseConfig_1.getUniversalParseMode)() === 'off') {
        return buildSkipResult(args.rawMessage, 'universal_parse_disabled');
    }
    const { keywords, lexicon } = await (0, channelKeywordsCache_1.getChannelParseContext)(supabase, args.channelRowId);
    const context = await buildUniversalParseContext(supabase, args);
    const { raw, error } = await callOpenAiUniversal(context);
    if (!raw) {
        return buildSkipResult(args.rawMessage, error ?? 'universal_parse_unavailable');
    }
    let intent = (0, coerceTradeIntent_1.coerceTradeIntent)(raw);
    const validation = (0, validateTradeIntent_1.validateTradeIntent)(intent, args.rawMessage);
    intent = validation.intent;
    if (!validation.ok) {
        return {
            intent,
            source: 'openai',
            skip_reason: validation.reason,
            parseResult: {
                parsed: (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, args.rawMessage),
                status: 'skipped',
                skip_reason: validation.reason,
            },
        };
    }
    if (intent.kind === 'commentary' || intent.kind === 'ignore') {
        return {
            intent,
            source: 'openai',
            skip_reason: 'AI classified as non-actionable',
            parseResult: {
                parsed: (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, args.rawMessage),
                status: 'skipped',
                skip_reason: 'AI classified as non-actionable',
            },
        };
    }
    let parsed = intentToLegacyParsed(intent, args.rawMessage, keywords);
    const eligibility = (0, signalExecutionEligibility_1.evaluateParsedSignalExecutionEligibility)(parsed, args.rawMessage, keywords);
    if ((parsed.action === 'buy' || parsed.action === 'sell') && !eligibility.eligible) {
        return {
            intent,
            source: 'openai',
            skip_reason: eligibility.skipReason ?? 'entry_not_execution_eligible',
            parseResult: {
                parsed,
                status: 'skipped',
                skip_reason: eligibility.skipReason ?? 'entry_not_execution_eligible',
            },
        };
    }
    if ((0, parseConfig_1.universalParseStoreIntent)()) {
        parsed = (0, tradeIntentAdapter_1.withStoredIntent)(parsed, intent);
    }
    return {
        intent,
        source: 'openai',
        skip_reason: null,
        parseResult: {
            parsed,
            status: parsed.action === 'ignore' ? 'skipped' : 'parsed',
            skip_reason: parsed.action === 'ignore' ? 'AI classified as non-actionable' : null,
        },
    };
}
function parseDeterministicForUniversal(rawMessage, keywords, lexicon, isModificationClass) {
    if (isModificationClass) {
        return (0, parseSignal_1.parseModificationDeterministic)(rawMessage, keywords, lexicon);
    }
    return (0, parseSignal_1.parseChannelMessageSync)(rawMessage, keywords, lexicon);
}
function deterministicQualifiesForFastPath(det, rawMessage, keywords) {
    if (det.status !== 'parsed' || det.parsed.action === 'ignore')
        return false;
    const conf = typeof det.parsed.confidence === 'number' ? det.parsed.confidence : 0;
    if (conf < (0, parseConfig_1.universalParseFastPathConfidence)())
        return false;
    const action = (0, tradeSignalActions_1.parsedAction)(det.parsed);
    if ((0, tradeSignalActions_1.isManagementAction)(action))
        return true;
    if (action === 'buy' || action === 'sell') {
        return (0, signalExecutionEligibility_1.evaluateParsedSignalExecutionEligibility)(det.parsed, rawMessage, keywords).eligible;
    }
    return false;
}
/** Legacy bridge: convert universal result using same path as old AI parsers. */
function universalResultToParseResult(result) {
    return result.parseResult;
}
