"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEnvBool = parseEnvBool;
exports.isUniversalParseEnabled = isUniversalParseEnabled;
exports.getUniversalParseMode = getUniversalParseMode;
exports.universalParseFastPathConfidence = universalParseFastPathConfidence;
exports.universalParseAiVetoEnabled = universalParseAiVetoEnabled;
exports.universalParseModel = universalParseModel;
exports.universalParseTimeoutMs = universalParseTimeoutMs;
exports.cerebrasParseEnabled = cerebrasParseEnabled;
exports.cerebrasParseModel = cerebrasParseModel;
exports.cerebrasParseMaxTokens = cerebrasParseMaxTokens;
exports.cerebrasParseRetries = cerebrasParseRetries;
exports.universalParseReconcileEnabled = universalParseReconcileEnabled;
exports.universalParseReconcileModel = universalParseReconcileModel;
exports.universalParseReconcileTimeoutMs = universalParseReconcileTimeoutMs;
exports.universalParseStoreIntent = universalParseStoreIntent;
const FASTPATH_CONFIDENCE = 0.99;
const CEREBRAS_MODEL = 'gpt-oss-120b';
const RECONCILE_MODEL = 'gpt-4o';
const RECONCILE_TIMEOUT_MS = 8000;
function parseEnvBool(name, defaultValue = false) {
    const raw = String(process.env[name] ?? (defaultValue ? 'true' : 'false')).trim();
    const v = raw.replace(/^["']|["']$/g, '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
function isUniversalParseEnabled() {
    if (parseEnvBool('UNIVERSAL_PARSE_ENABLED', true))
        return true;
    return getUniversalParseMode() !== 'off';
}
function getUniversalParseMode() {
    const raw = String(process.env.UNIVERSAL_PARSE_MODE ?? 'shadow').trim().toLowerCase();
    if (raw === 'fastpath' || raw === 'primary' || raw === 'shadow' || raw === 'off') {
        return raw;
    }
    return 'shadow';
}
function universalParseFastPathConfidence() {
    const n = Number(process.env.UNIVERSAL_PARSE_FASTPATH_CONFIDENCE ?? FASTPATH_CONFIDENCE);
    return Number.isFinite(n) ? Math.min(1, Math.max(0.5, n)) : FASTPATH_CONFIDENCE;
}
/** AI may veto an otherwise parsed deterministic candidate only when enabled. */
function universalParseAiVetoEnabled() {
    return parseEnvBool('UNIVERSAL_PARSE_AI_VETO_ENABLED', false);
}
function universalParseModel() {
    return String(process.env.UNIVERSAL_PARSE_MODEL
        ?? process.env.AI_ENTRY_PARSE_MODEL
        ?? process.env.AI_MODIFICATION_PARSE_MODEL
        ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini';
}
function universalParseTimeoutMs() {
    return Math.max(500, Math.min(15000, Number(process.env.UNIVERSAL_PARSE_TIMEOUT_MS ?? 4000)));
}
/** Stage 2 provider: fast OSS model on Cerebras Inference (OpenAI-compatible). */
function cerebrasParseEnabled() {
    return parseEnvBool('CEREBRAS_PARSE_ENABLED', true);
}
function cerebrasParseModel() {
    return String(process.env.CEREBRAS_PARSE_MODEL ?? CEREBRAS_MODEL).trim() || CEREBRAS_MODEL;
}
/** gpt-oss-120b is a reasoning model — it emits reasoning tokens before content.
 *  A 500-token cap leaves too little room for the JSON answer, causing empty or
 *  truncated content that silently triggers the OpenAI fallback. Default to a
 *  generous budget that comfortably fits reasoning + the JSON payload. */
function cerebrasParseMaxTokens() {
    const n = Number(process.env.CEREBRAS_PARSE_MAX_TOKENS ?? 2000);
    return Number.isFinite(n) ? Math.max(500, Math.min(8000, Math.round(n))) : 2000;
}
/** How many attempts to make against Cerebras before falling back to OpenAI.
 *  Cerebras aggressively rate-limits (429) under bursts, so a short retry with
 *  backoff recovers transient limits instead of silently degrading. */
function cerebrasParseRetries() {
    const n = Number(process.env.CEREBRAS_PARSE_RETRIES ?? 2);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 2;
}
/** Stage 3: GPT-4o reconciliation between deterministic and stage-2 results. */
function universalParseReconcileEnabled() {
    return parseEnvBool('UNIVERSAL_PARSE_RECONCILE_ENABLED', false);
}
function universalParseReconcileModel() {
    return String(process.env.UNIVERSAL_PARSE_RECONCILE_MODEL ?? RECONCILE_MODEL).trim() || RECONCILE_MODEL;
}
function universalParseReconcileTimeoutMs() {
    return Math.max(1000, Math.min(30000, Number(process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS ?? RECONCILE_TIMEOUT_MS)));
}
function universalParseStoreIntent() {
    return parseEnvBool('UNIVERSAL_PARSE_STORE_INTENT', true);
}
