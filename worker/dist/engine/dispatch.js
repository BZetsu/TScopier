"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifySignal = classifySignal;
exports.isEntry = isEntry;
exports.isDesiredStateOnly = isDesiredStateOnly;
const ENTRY_ACTIONS = new Set(['buy', 'sell']);
const MGMT_MODIFY = new Set(['modify']);
const MGMT_CLOSE = new Set(['close']);
const MGMT_BREAKEVEN = new Set(['breakeven']);
const MGMT_PARTIAL = new Set(['partial_profit', 'partial_breakeven', 'partial_close']);
/** Classify a parsed action into the v2 routing lane. */
function classifySignal(action, reEnter) {
    const a = (action ?? '').trim().toLowerCase();
    if (reEnter && ENTRY_ACTIONS.has(a))
        return 'entry';
    if (ENTRY_ACTIONS.has(a))
        return 'entry';
    if (MGMT_MODIFY.has(a))
        return 'modify';
    if (MGMT_CLOSE.has(a))
        return 'close';
    if (MGMT_BREAKEVEN.has(a))
        return 'breakeven';
    if (MGMT_PARTIAL.has(a))
        return 'partial';
    return 'ignore';
}
function isEntry(kind) {
    return kind === 'entry';
}
/** Management lanes update desired-state and let the reconciler converge - they never
 * call the broker directly, so they cannot half-apply, revert, or duplicate. */
function isDesiredStateOnly(kind) {
    return kind === 'modify' || kind === 'close' || kind === 'breakeven';
}
