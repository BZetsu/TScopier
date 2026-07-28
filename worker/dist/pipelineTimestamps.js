"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePipelineTimestamps = parsePipelineTimestamps;
exports.setPipelineTimestamp = setPipelineTimestamp;
exports.safeDurationMs = safeDurationMs;
exports.pipelineSummaryPayload = pipelineSummaryPayload;
exports.buildPipelineCorrelation = buildPipelineCorrelation;
exports.redactForObservability = redactForObservability;
exports.emitPipelineEvent = emitPipelineEvent;
const workerMetrics_1 = require("./workerMetrics");
const TIMESTAMP_KEYS = [
    'telegram_source_message_at',
    'telegram_message_received_at',
    'message_normalized_at',
    'parse_started_at',
    'parse_completed_at',
    'signal_persist_started_at',
    'signal_persist_completed_at',
    'queue_publish_started_at',
    'queue_published_at',
    'queue_consumed_at',
    'execution_planning_started_at',
    'execution_planning_completed_at',
    'execution_claim_started_at',
    'execution_claim_acquired_at',
    'broker_resolution_started_at',
    'broker_ready_at',
    'broker_request_started_at',
    'broker_response_received_at',
    'broker_execution_confirmed_at',
    'execution_state_persisted_at',
    'reconciliation_started_at',
    'reconciliation_completed_at',
    't_ai_parse_done',
    't_telegram_event',
    't_listener_received',
    't_parse_done',
    't_dispatch_sent',
    't_dispatch_received',
    't_order_send_start',
    't_send_caches_resolved',
    't_session_resolved',
    't_symbol_resolved',
    't_params_resolved',
    't_first_broker_send',
    't_last_broker_send',
    't_order_send_done',
];
function parsePipelineTimestamps(raw) {
    if (raw == null || typeof raw !== 'object')
        return undefined;
    const o = raw;
    const ts = {};
    for (const key of TIMESTAMP_KEYS) {
        const value = o[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            ts[key] = value;
        }
    }
    ts.telegram_source_message_at = ts.telegram_source_message_at ?? ts.t_telegram_event;
    ts.telegram_message_received_at = ts.telegram_message_received_at ?? ts.t_listener_received;
    ts.parse_completed_at = ts.parse_completed_at ?? ts.t_parse_done;
    ts.queue_published_at = ts.queue_published_at ?? ts.t_dispatch_sent;
    ts.queue_consumed_at = ts.queue_consumed_at ?? ts.t_dispatch_received;
    ts.execution_planning_started_at = ts.execution_planning_started_at ?? ts.t_order_send_start;
    ts.broker_ready_at = ts.broker_ready_at ?? ts.t_send_caches_resolved;
    ts.broker_request_started_at = ts.broker_request_started_at ?? ts.t_first_broker_send;
    ts.broker_response_received_at = ts.broker_response_received_at ?? ts.t_last_broker_send;
    ts.execution_state_persisted_at = ts.execution_state_persisted_at ?? ts.t_order_send_done;
    return Object.values(ts).some(v => v != null) ? ts : undefined;
}
function setPipelineTimestamp(ts, key, at = Date.now()) {
    const out = ts ?? {};
    out[key] = at;
    switch (key) {
        case 'telegram_source_message_at':
            out.t_telegram_event = out.t_telegram_event ?? at;
            break;
        case 'telegram_message_received_at':
            out.t_listener_received = out.t_listener_received ?? at;
            break;
        case 'parse_completed_at':
            out.t_parse_done = out.t_parse_done ?? at;
            break;
        case 'queue_published_at':
            out.t_dispatch_sent = out.t_dispatch_sent ?? at;
            break;
        case 'queue_consumed_at':
            out.t_dispatch_received = out.t_dispatch_received ?? at;
            break;
        case 'execution_planning_started_at':
            out.t_order_send_start = out.t_order_send_start ?? at;
            break;
        case 'broker_ready_at':
            out.t_send_caches_resolved = out.t_send_caches_resolved ?? at;
            break;
        case 'broker_request_started_at':
            out.t_first_broker_send = out.t_first_broker_send ?? at;
            break;
        case 'broker_response_received_at':
            out.t_last_broker_send = at;
            break;
        case 'execution_state_persisted_at':
            out.t_order_send_done = out.t_order_send_done ?? at;
            break;
        default:
            break;
    }
    return out;
}
function safeDurationMs(end, start) {
    if (end == null || start == null)
        return null;
    if (!Number.isFinite(end) || !Number.isFinite(start))
        return null;
    return Math.max(0, end - start);
}
function pipelineSummaryPayload(ts, extra) {
    const parsed = parsePipelineTimestamps(ts) ?? ts;
    const t0 = parsed.telegram_source_message_at ?? parsed.telegram_message_received_at ?? parsed.queue_consumed_at;
    const tEnd = parsed.reconciliation_completed_at
        ?? parsed.execution_state_persisted_at
        ?? parsed.broker_execution_confirmed_at
        ?? parsed.broker_response_received_at
        ?? parsed.queue_consumed_at
        ?? Date.now();
    const telegramToListenerMs = safeDurationMs(parsed.telegram_message_received_at, parsed.telegram_source_message_at);
    const parseMs = safeDurationMs(parsed.parse_completed_at, parsed.parse_started_at ?? parsed.telegram_message_received_at);
    const persistMs = safeDurationMs(parsed.signal_persist_completed_at, parsed.signal_persist_started_at);
    const dispatchMs = safeDurationMs(parsed.queue_published_at, parsed.queue_publish_started_at);
    const queueWaitMs = safeDurationMs(parsed.queue_consumed_at, parsed.queue_published_at);
    const prepMs = safeDurationMs(parsed.execution_planning_started_at, parsed.queue_consumed_at);
    const sendOrderMs = safeDurationMs(parsed.execution_state_persisted_at, parsed.execution_planning_started_at);
    const brokerSendMs = safeDurationMs(parsed.broker_response_received_at, parsed.broker_request_started_at);
    const sendOrderPrepMs = safeDurationMs(parsed.broker_request_started_at, parsed.execution_planning_started_at);
    const brokerResolveMs = safeDurationMs(parsed.broker_ready_at, parsed.broker_resolution_started_at ?? parsed.execution_planning_started_at);
    const sendPlanMs = safeDurationMs(parsed.broker_request_started_at, parsed.broker_ready_at);
    const sessionMs = safeDurationMs(parsed.t_session_resolved, parsed.execution_planning_started_at);
    const symbolMs = safeDurationMs(parsed.t_symbol_resolved, parsed.execution_planning_started_at);
    const paramsMs = safeDurationMs(parsed.t_params_resolved, parsed.execution_planning_started_at);
    const totalMs = safeDurationMs(tEnd, t0);
    return {
        ...extra,
        telegram_source_to_worker_receipt_ms: telegramToListenerMs,
        telegram_to_listener_ms: telegramToListenerMs,
        worker_receipt_to_parse_start_ms: safeDurationMs(parsed.parse_started_at, parsed.telegram_message_received_at),
        parse_ms: parseMs,
        signal_persist_ms: persistMs,
        dispatch_ms: dispatchMs,
        queue_wait_ms: queueWaitMs,
        prep_ms: prepMs,
        planning_ms: safeDurationMs(parsed.execution_planning_completed_at, parsed.execution_planning_started_at),
        execution_claim_ms: safeDurationMs(parsed.execution_claim_acquired_at, parsed.execution_claim_started_at),
        order_send_ms: sendOrderMs,
        send_order_ms: sendOrderMs,
        broker_send_ms: brokerSendMs,
        broker_request_ms: brokerSendMs,
        broker_ack_ms: safeDurationMs(parsed.broker_execution_confirmed_at, parsed.broker_request_started_at),
        send_order_prep_ms: sendOrderPrepMs,
        broker_resolve_ms: brokerResolveMs,
        send_plan_ms: sendPlanMs,
        session_resolve_ms: sessionMs,
        symbol_resolve_ms: symbolMs,
        params_resolve_ms: paramsMs,
        telegram_receipt_to_broker_request_ms: safeDurationMs(parsed.broker_request_started_at, parsed.telegram_message_received_at),
        telegram_receipt_to_broker_confirmation_ms: safeDurationMs(parsed.broker_execution_confirmed_at, parsed.telegram_message_received_at),
        reconciliation_ms: safeDurationMs(parsed.reconciliation_completed_at, parsed.reconciliation_started_at),
        total_ms: totalMs,
        timestamps: parsed,
    };
}
function buildPipelineCorrelation(input) {
    return {
        user_id: input.user_id ?? input.userId ?? null,
        signal_id: input.signal_id ?? input.signalId ?? input.id ?? null,
        telegram_message_id: input.telegram_message_id ?? input.telegramMessageId ?? null,
        channel_id: input.channel_id ?? input.channelId ?? null,
        broker_account_id: input.broker_account_id ?? input.brokerAccountId ?? null,
        pending_leg_id: input.pending_leg_id ?? input.pendingLegId ?? null,
        queue_message_id: input.queue_message_id ?? input.queueMessageId ?? null,
        execution_attempt_id: input.execution_attempt_id ?? input.executionAttemptId ?? null,
        broker_request_id: input.broker_request_id ?? input.brokerRequestId ?? null,
        dispatch_source: input.dispatch_source ?? input.dispatchSource ?? null,
        worker_role: input.worker_role ?? input.workerRole ?? null,
        shard_id: input.shard_id ?? input.shardId ?? null,
    };
}
const SENSITIVE_KEY_RE = /(?:password|secret|token|bearer|cookie|set-cookie|authorization|api[_-]?key|auth[_-]?key|service[_-]?role[_-]?key|supabase[_-]?service[_-]?role[_-]?key|session[_-]?string|client[_-]?secret|private[_-]?key|x-api-key|access[_-]?token)/i;
function redactForObservability(input) {
    if (Array.isArray(input))
        return input.map(redactForObservability);
    if (!input || typeof input !== 'object')
        return input;
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (SENSITIVE_KEY_RE.test(key)) {
            out[key] = '[REDACTED]';
        }
        else if (value && typeof value === 'object') {
            out[key] = redactForObservability(value);
        }
        else {
            out[key] = value;
        }
    }
    return out;
}
function emitPipelineEvent(args, opts) {
    try {
        (0, workerMetrics_1.incMetric)(`pipeline_event_${args.event}`);
        const ts = args.timestamps ? parsePipelineTimestamps(args.timestamps) : undefined;
        const durations = ts ? pipelineSummaryPayload(ts) : {};
        for (const [key, value] of Object.entries(durations)) {
            if (key.endsWith('_ms') && typeof value === 'number') {
                (0, workerMetrics_1.observeMetric)(`pipeline_${key}`, value);
            }
        }
        const payload = {
            event: args.event,
            component: 'executionPipeline',
            correlation: args.correlation ?? {},
            outcome: args.outcome ?? null,
            path: args.path ?? null,
            stage: args.stage ?? null,
            error_code: args.error_code ?? null,
            durations,
            ...(args.extra ?? {}),
        };
        if (opts?.deferLog === true) {
            const write = () => {
                try {
                    console.log(JSON.stringify(redactForObservability(payload)));
                }
                catch {
                    // Observability must never affect trade execution.
                }
            };
            if (typeof setImmediate === 'function')
                setImmediate(write);
            else
                queueMicrotask(write);
            return;
        }
        console.log(JSON.stringify(redactForObservability(payload)));
    }
    catch {
        // Observability must never affect trade execution.
    }
}
