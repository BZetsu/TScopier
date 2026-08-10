"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureDeferredBusinessFailure = captureDeferredBusinessFailure;
const sentryRedaction_1 = require("./sentryRedaction");
const businessEvents_1 = require("./businessEvents");
function safeErrorSummary(err) {
    if (err == null)
        return null;
    const raw = err instanceof Error ? err.message : String(err);
    return raw
        .replace(/\b(session_string|account_number|password|token|secret|api_key|auth_key|authorization|phone|email)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
        .slice(0, 300);
}
function captureDeferredBusinessFailure(args) {
    try {
        const reasonCode = args.reasonCode ?? (0, sentryRedaction_1.normalizedErrorCode)(args.err, 'DEFERRED_OPERATION_FAILED');
        (0, businessEvents_1.captureBusinessIssue)({
            category: args.category,
            event: args.event,
            severity: args.severity ?? 'error',
            reasonCode,
            message: args.message,
            userImpact: args.userImpact,
            dedupeKey: args.dedupeKey,
            fingerprint: args.fingerprint,
            context: {
                ...(args.context ?? {}),
                operation: args.context?.operation ?? args.operation,
                stage: args.context?.stage ?? 'deferred_follow_up',
                extra: {
                    ...(args.context?.extra ?? {}),
                    user_visible_state_may_be_stale: true,
                    broker_database_state_may_disagree: true,
                    error: safeErrorSummary(args.err),
                },
            },
        });
    }
    catch {
        // Deferred observability must never affect trade outcomes.
    }
}
