"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLayeringModesAccountAllowlist = parseLayeringModesAccountAllowlist;
exports.resolveLayeringModeRolloutDecision = resolveLayeringModeRolloutDecision;
function parseStrictBoolean(value, fallback, opts) {
    if (value == null || value.trim() === '')
        return fallback;
    const raw = value.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes')
        return true;
    if (raw === 'false' || raw === '0' || raw === 'no')
        return false;
    return opts?.invalidIs ?? fallback;
}
function safeAccountId(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    for (const char of trimmed) {
        const code = char.charCodeAt(0);
        if (code <= 32 || code === 127)
            return null;
    }
    if (/[*?%/\\]/.test(trimmed))
        return null;
    return trimmed;
}
function parseLayeringModesAccountAllowlist(raw) {
    const out = new Set();
    for (const part of String(raw ?? '').split(',')) {
        const accountId = safeAccountId(part);
        if (accountId)
            out.add(accountId);
    }
    return out;
}
function resolveLayeringModeRolloutDecision(input) {
    const env = input.env ?? process.env;
    const mode = input.mode;
    if (mode === 'legacy') {
        return {
            allowed: true,
            prepareAllowed: true,
            activationAllowed: true,
            executionAllowed: true,
            reason: 'legacy',
        };
    }
    const globalEnabled = parseStrictBoolean(env.LAYERING_MODES_EXECUTION_ENABLED, false);
    if (!globalEnabled) {
        return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'global_disabled' };
    }
    const killSwitchActive = parseStrictBoolean(env.LAYERING_MODES_KILL_SWITCH, true, { invalidIs: true });
    if (killSwitchActive) {
        return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'kill_switch_active' };
    }
    const modeFlagName = mode === 'static'
        ? 'LAYERING_STATIC_EXECUTION_ENABLED'
        : 'LAYERING_DYNAMIC_EXECUTION_ENABLED';
    if (!parseStrictBoolean(env[modeFlagName], false)) {
        return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'mode_disabled' };
    }
    const allowlist = parseLayeringModesAccountAllowlist(env.LAYERING_MODES_ACCOUNT_ALLOWLIST);
    const accountId = typeof input.brokerAccountId === 'string' ? input.brokerAccountId.trim() : '';
    if (!accountId || !allowlist.has(accountId)) {
        return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'account_not_allowlisted' };
    }
    const prepareOnly = parseStrictBoolean(env.LAYERING_MODES_PREPARE_ONLY, true, { invalidIs: true });
    if (prepareOnly) {
        return { allowed: true, prepareAllowed: true, activationAllowed: false, executionAllowed: false, reason: 'prepare_only' };
    }
    return {
        allowed: true,
        prepareAllowed: true,
        activationAllowed: true,
        executionAllowed: true,
        reason: 'allowed',
    };
}
