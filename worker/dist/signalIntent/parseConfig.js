"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEnvBool = parseEnvBool;
exports.isUniversalParseEnabled = isUniversalParseEnabled;
exports.getUniversalParseMode = getUniversalParseMode;
exports.universalParseFastPathConfidence = universalParseFastPathConfidence;
exports.universalParseModel = universalParseModel;
exports.universalParseTimeoutMs = universalParseTimeoutMs;
exports.universalParseStoreIntent = universalParseStoreIntent;
const FASTPATH_CONFIDENCE = 0.95;
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
function universalParseModel() {
    return String(process.env.UNIVERSAL_PARSE_MODEL
        ?? process.env.AI_ENTRY_PARSE_MODEL
        ?? process.env.AI_MODIFICATION_PARSE_MODEL
        ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini';
}
function universalParseTimeoutMs() {
    return Math.max(500, Math.min(15000, Number(process.env.UNIVERSAL_PARSE_TIMEOUT_MS ?? 4000)));
}
function universalParseStoreIntent() {
    return parseEnvBool('UNIVERSAL_PARSE_STORE_INTENT', true);
}
