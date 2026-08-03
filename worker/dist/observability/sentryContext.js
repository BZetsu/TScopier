"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafePipelineContext = buildSafePipelineContext;
const node_crypto_1 = require("node:crypto");
const workerConfig_1 = require("../workerConfig");
const pipelineTimestamps_1 = require("../pipelineTimestamps");
const sentryRedaction_1 = require("./sentryRedaction");
function hashId(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed)
        return null;
    return (0, node_crypto_1.createHash)('sha256').update(trimmed).digest('hex').slice(0, 16);
}
function buildSafePipelineContext(input = {}) {
    const ts = input.timestamps ? (0, pipelineTimestamps_1.parsePipelineTimestamps)(input.timestamps) : undefined;
    const durations = ts ? (0, pipelineTimestamps_1.pipelineSummaryPayload)(ts) : undefined;
    return (0, sentryRedaction_1.safeForSentry)({
        pipeline: {
            stage: input.stage ?? null,
            operation: input.operation ?? null,
            dispatch_source: input.dispatch_source ?? input.dispatchSource ?? null,
            signal_id: input.signal_id ?? input.signalId ?? input.id ?? null,
            channel_row_id: input.channel_id ?? input.channelId ?? null,
            telegram_message_id: input.telegram_message_id ?? input.telegramMessageId ?? null,
            broker_account_id: input.broker_account_id ?? input.brokerAccountId ?? null,
            execution_parent_id: input.execution_parent_id ?? null,
            execution_attempt_id: input.execution_attempt_id ?? input.executionAttemptId ?? null,
            pending_leg_id: input.pending_leg_id ?? input.pendingLegId ?? null,
            basket_id: input.basket_id ?? null,
            queue_message_id: input.queue_message_id ?? input.queueMessageId ?? null,
            reconciliation_id: input.reconciliation_id ?? null,
            retry_attempt: input.retry_attempt ?? null,
            load_run_id: input.load_run_id ?? null,
            load_test: input.load_test === true,
            user_hash: hashId(input.user_id ?? input.userId ?? null),
        },
        worker: {
            role: workerConfig_1.workerConfig.role,
            shard_id: workerConfig_1.workerConfig.shardId,
            shard_count: workerConfig_1.workerConfig.shardCount,
            build_tag: workerConfig_1.WORKER_BUILD_TAG,
        },
        durations,
        extra: input.extra ?? undefined,
    });
}
