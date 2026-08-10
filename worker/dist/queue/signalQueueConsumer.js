"use strict";
/**
 * Shard-aware Redis Streams consumer for trade_entry / trade_mgmt workers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalQueueConsumerManager = exports.SignalQueueConsumer = void 0;
const workerConfig_1 = require("../workerConfig");
const workerMetrics_1 = require("../workerMetrics");
const sentry_1 = require("../observability/sentry");
const businessEvents_1 = require("../observability/businessEvents");
const pipelineTimestamps_1 = require("../pipelineTimestamps");
const redisStreamsClient_1 = require("./redisStreamsClient");
const signalQueueConfig_1 = require("./signalQueueConfig");
const signalQueueIdempotency_1 = require("./signalQueueIdempotency");
const signalQueuePublisher_1 = require("./signalQueuePublisher");
const signalQueueRetry_1 = require("./signalQueueRetry");
class SignalQueueConsumer {
    constructor(supabase, tradeExecutor, lane) {
        this.supabase = supabase;
        this.tradeExecutor = tradeExecutor;
        this.lane = lane;
        this.stopped = false;
        this.readLoopPromise = null;
        this.reclaimLoopPromise = null;
        this.reclaimCursor = '0-0';
        this.lastReadAt = null;
        this.lastAckAt = null;
        this.lastError = null;
        this.readErrorStreak = 0;
        this.reclaimErrorStreak = 0;
    }
    static lanesForWorker() {
        const lanes = [];
        if ((0, signalQueueConfig_1.shouldConsumeQueueLane)('entry'))
            lanes.push('entry');
        if ((0, signalQueueConfig_1.shouldConsumeQueueLane)('mgmt'))
            lanes.push('mgmt');
        return lanes;
    }
    start() {
        if (this.readLoopPromise)
            return;
        this.stopped = false;
        const streamKey = (0, signalQueueConfig_1.streamKeyForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const group = (0, signalQueueConfig_1.consumerGroupForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        void (0, redisStreamsClient_1.xgroupCreateMkStream)(streamKey, group).catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[signalQueue] XGROUP CREATE failed stream=${streamKey}: ${msg}`);
        });
        this.readLoopPromise = this.readLoop();
        this.reclaimLoopPromise = this.reclaimLoop();
        console.log(`[signalQueue] consumer started lane=${this.lane} shard=${workerConfig_1.workerConfig.shardId}`
            + ` stream=${streamKey} group=${group}`);
    }
    async stop() {
        this.stopped = true;
        await Promise.allSettled([this.readLoopPromise, this.reclaimLoopPromise]);
        this.readLoopPromise = null;
        this.reclaimLoopPromise = null;
    }
    async getMetrics() {
        const streamKey = (0, signalQueueConfig_1.streamKeyForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const group = (0, signalQueueConfig_1.consumerGroupForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        let streamLength = 0;
        let pending = 0;
        try {
            streamLength = await (0, redisStreamsClient_1.xlen)(streamKey);
            const summary = await (0, redisStreamsClient_1.xpendingSummary)(streamKey, group);
            pending = summary.pending;
        }
        catch {
            /* best-effort */
        }
        return {
            lane: this.lane,
            stream_key: streamKey,
            stream_length: streamLength,
            pending,
            last_read_at: this.lastReadAt ? new Date(this.lastReadAt).toISOString() : null,
            last_ack_at: this.lastAckAt ? new Date(this.lastAckAt).toISOString() : null,
            last_error: this.lastError,
        };
    }
    consumerName() {
        return `${workerConfig_1.workerConfig.instanceId}:${this.lane}`;
    }
    async readLoop() {
        const cfg = (0, signalQueueConfig_1.signalQueueConfig)();
        const blockMs = this.lane === 'mgmt' ? cfg.mgmtConsumerBlockMs : cfg.consumerBlockMs;
        const streamKey = (0, signalQueueConfig_1.streamKeyForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const group = (0, signalQueueConfig_1.consumerGroupForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const consumer = this.consumerName();
        while (!this.stopped) {
            try {
                const messages = await (0, redisStreamsClient_1.xreadgroup)(group, consumer, streamKey, cfg.readCount, blockMs);
                this.lastReadAt = Date.now();
                this.readErrorStreak = 0;
                if (messages.length === 0)
                    continue;
                await mapConcurrent(messages, cfg.consumerConcurrency, msg => this.processMessage(streamKey, group, msg));
            }
            catch (err) {
                this.lastError = err instanceof Error ? err.message : String(err);
                this.readErrorStreak += 1;
                (0, workerMetrics_1.incMetric)('queue_consumer_read_errors');
                console.warn(`[signalQueue] read error lane=${this.lane}: ${this.lastError}`);
                if (this.readErrorStreak === 3 || this.readErrorStreak % 10 === 0) {
                    (0, businessEvents_1.captureBusinessIssue)({
                        category: 'queue',
                        event: 'signal_dispatch_failed',
                        severity: 'warning',
                        reasonCode: 'QUEUE_READ_FAILURE',
                        message: 'Signal queue consumer read failed repeatedly',
                        userImpact: 'delayed',
                        fingerprint: ['signal_dispatch_failed', 'queue_read', 'QUEUE_READ_FAILURE', this.lane],
                        context: {
                            stage: 'queue_read',
                            operation: 'queue_read',
                            dispatch_source: 'queue',
                            retry_attempt: this.readErrorStreak,
                            extra: { lane: this.lane, stream_key: streamKey },
                        },
                    });
                }
                await sleep(Math.min(5000, blockMs));
            }
        }
    }
    async reclaimLoop() {
        const cfg = (0, signalQueueConfig_1.signalQueueConfig)();
        const streamKey = (0, signalQueueConfig_1.streamKeyForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const group = (0, signalQueueConfig_1.consumerGroupForLane)(this.lane, workerConfig_1.workerConfig.shardId);
        const consumer = this.consumerName();
        const intervalMs = Math.max(5000, Math.floor(cfg.claimIdleMs / 3));
        while (!this.stopped) {
            await sleep(intervalMs);
            if (this.stopped)
                break;
            try {
                const { nextStart, messages } = await (0, redisStreamsClient_1.xautoclaim)(streamKey, group, consumer, cfg.claimIdleMs, this.reclaimCursor, cfg.readCount);
                this.reclaimCursor = nextStart;
                this.reclaimErrorStreak = 0;
                if (messages.length === 0)
                    continue;
                (0, workerMetrics_1.incMetric)('queue_reclaimed', messages.length);
                await mapConcurrent(messages, cfg.consumerConcurrency, msg => this.processMessage(streamKey, group, msg, { reclaimed: true }));
            }
            catch (err) {
                this.lastError = err instanceof Error ? err.message : String(err);
                this.reclaimErrorStreak += 1;
                (0, workerMetrics_1.incMetric)('queue_consumer_reclaim_errors');
                console.warn(`[signalQueue] reclaim error lane=${this.lane}: ${this.lastError}`);
                if (this.reclaimErrorStreak === 3 || this.reclaimErrorStreak % 10 === 0) {
                    (0, businessEvents_1.captureBusinessIssue)({
                        category: 'queue',
                        event: 'signal_dispatch_failed',
                        severity: 'warning',
                        reasonCode: 'QUEUE_RECLAIM_FAILURE',
                        message: 'Signal queue reclaim failed repeatedly',
                        userImpact: 'delayed',
                        fingerprint: ['signal_dispatch_failed', 'queue_reclaim', 'QUEUE_RECLAIM_FAILURE', this.lane],
                        context: {
                            stage: 'queue_reclaim',
                            operation: 'queue_reclaim',
                            dispatch_source: 'queue',
                            retry_attempt: this.reclaimErrorStreak,
                            extra: { lane: this.lane, stream_key: streamKey },
                        },
                    });
                }
            }
        }
    }
    async processMessage(streamKey, group, msg, opts) {
        const job = (0, signalQueuePublisher_1.parseQueueJobFields)(msg.fields);
        if (!job) {
            (0, workerMetrics_1.incMetric)('queue_malformed');
            (0, businessEvents_1.captureBusinessIssue)({
                category: 'queue',
                event: 'signal_dispatch_failed',
                severity: 'error',
                reasonCode: 'QUEUE_MALFORMED_PAYLOAD',
                message: 'Malformed signal queue payload was acknowledged without dispatch',
                userImpact: 'failed',
                fingerprint: ['signal_dispatch_failed', 'queue_parse', 'QUEUE_MALFORMED_PAYLOAD', this.lane],
                context: {
                    stage: 'queue_parse',
                    operation: 'queue_parse',
                    queue_message_id: msg.id,
                    extra: { lane: this.lane, stream_key: streamKey },
                },
            });
            await (0, redisStreamsClient_1.xack)(streamKey, group, msg.id);
            return;
        }
        const attempts = (0, signalQueueRetry_1.parseAttemptCount)(msg.fields);
        const receivedAt = Date.now();
        job.pipeline_ts = (0, pipelineTimestamps_1.setPipelineTimestamp)(job.pipeline_ts ?? {}, 'queue_consumed_at', receivedAt);
        const enqueueToStartMs = Math.max(0, receivedAt - job.enqueued_at);
        const correlation = (0, pipelineTimestamps_1.buildPipelineCorrelation)({
            userId: job.user_id,
            signalId: job.signal_id,
            channelId: job.channel_id,
            queueMessageId: msg.id,
            dispatchSource: 'queue',
        });
        (0, pipelineTimestamps_1.emitPipelineEvent)({
            event: 'queue_consumed',
            correlation,
            timestamps: job.pipeline_ts,
            outcome: 'started',
            path: job.lane,
            extra: {
                shard_id: job.shard_id,
                attempts,
                reclaimed: opts?.reclaimed === true,
            },
        });
        const claimed = await (0, signalQueueIdempotency_1.claimQueueIdempotency)(this.supabase, job.idempotency_key, {
            signal_id: job.signal_id,
            user_id: job.user_id,
            lane: job.lane,
        });
        if (!claimed) {
            (0, workerMetrics_1.incMetric)('queue_duplicate_skip');
            (0, sentry_1.addWorkerBreadcrumb)({
                category: 'queue',
                message: 'duplicate queue message skipped',
                level: 'info',
                data: { lane: job.lane, attempts },
            });
            (0, pipelineTimestamps_1.emitPipelineEvent)({
                event: 'execution_duplicate_prevented',
                correlation,
                timestamps: job.pipeline_ts,
                outcome: 'duplicate',
                path: job.lane,
                extra: {
                    idempotency_key: job.idempotency_key,
                    attempts,
                },
            });
            await (0, redisStreamsClient_1.xack)(streamKey, group, msg.id);
            this.lastAckAt = Date.now();
            return;
        }
        const signalRow = {
            ...job.signal,
            pipeline_ts: job.pipeline_ts,
        };
        void (0, signalQueueRetry_1.logQueueExecution)(this.supabase, {
            user_id: job.user_id,
            signal_id: job.signal_id,
            action: 'queue_consume_start',
            status: 'success',
            request_payload: {
                message_id: msg.id,
                lane: job.lane,
                shard_id: job.shard_id,
                attempts,
                enqueue_to_start_ms: enqueueToStartMs,
                reclaimed: opts?.reclaimed === true,
            },
        });
        try {
            const accepted = await this.tradeExecutor.acceptDispatchSignalAwait(signalRow, {
                priority: job.priority,
                source: 'queue',
            });
            if (!accepted) {
                throw new Error('trade_executor_rejected_signal');
            }
            await (0, redisStreamsClient_1.xack)(streamKey, group, msg.id);
            this.lastAckAt = Date.now();
            (0, workerMetrics_1.incMetric)('queue_consume_ok');
            void (0, signalQueueRetry_1.logQueueExecution)(this.supabase, {
                user_id: job.user_id,
                signal_id: job.signal_id,
                action: 'queue_consume_ack',
                status: 'success',
                request_payload: {
                    message_id: msg.id,
                    enqueue_to_ack_ms: Date.now() - job.enqueued_at,
                },
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.lastError = reason;
            (0, workerMetrics_1.incMetric)('queue_consume_failed');
            if (!(0, signalQueueRetry_1.shouldRetryAfterFailure)(attempts)) {
                (0, workerMetrics_1.incMetric)('queue_dlq');
                (0, businessEvents_1.captureBusinessIssue)({
                    category: 'queue',
                    event: 'signal_queue_dead_lettered',
                    severity: 'error',
                    reasonCode: 'QUEUE_DEAD_LETTER',
                    message: 'Signal queue job dead-lettered after final retry',
                    userImpact: 'failed',
                    fingerprint: ['signal_queue_dead_lettered', job.lane, 'QUEUE_DEAD_LETTER'],
                    context: {
                        user_id: job.user_id,
                        signal_id: job.signal_id,
                        queue_message_id: msg.id,
                        dispatch_source: 'queue',
                        stage: 'queue_dead_letter',
                        operation: 'queue_consume',
                        retry_attempt: attempts,
                        extra: { lane: job.lane, shard_id: job.shard_id },
                    },
                });
                await (0, signalQueueRetry_1.persistDeadLetter)(this.supabase, {
                    stream_key: streamKey,
                    message_id: msg.id,
                    idempotency_key: job.idempotency_key,
                    signal_id: job.signal_id,
                    user_id: job.user_id,
                    lane: job.lane,
                    shard_id: job.shard_id,
                    attempts,
                    reason,
                    payload: job.signal,
                });
                await (0, redisStreamsClient_1.xack)(streamKey, group, msg.id);
                void (0, signalQueueRetry_1.logQueueExecution)(this.supabase, {
                    user_id: job.user_id,
                    signal_id: job.signal_id,
                    action: 'queue_dead_letter',
                    status: 'failed',
                    request_payload: {
                        message_id: msg.id,
                        attempts,
                        reason: reason.slice(0, 200),
                    },
                });
                return;
            }
            void (0, signalQueueRetry_1.logQueueExecution)(this.supabase, {
                user_id: job.user_id,
                signal_id: job.signal_id,
                action: 'queue_consume_retry',
                status: 'failed',
                request_payload: {
                    message_id: msg.id,
                    attempts,
                    next_attempt: attempts + 1,
                    reason: reason.slice(0, 200),
                    backoff_ms: (0, signalQueueRetry_1.retryBackoffMs)(attempts),
                    reclaimed: opts?.reclaimed === true,
                },
            });
            // Leave unacked — XAUTOCLAIM will retry after claim idle timeout.
        }
    }
}
exports.SignalQueueConsumer = SignalQueueConsumer;
async function mapConcurrent(items, limit, fn) {
    if (items.length === 0)
        return;
    const pool = Math.max(1, Math.min(limit, items.length));
    let idx = 0;
    await Promise.all(Array.from({ length: pool }, async () => {
        while (idx < items.length) {
            const i = idx++;
            await fn(items[i]);
        }
    }));
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class SignalQueueConsumerManager {
    constructor(supabase, tradeExecutor) {
        this.supabase = supabase;
        this.tradeExecutor = tradeExecutor;
        this.consumers = [];
    }
    start() {
        if (this.consumers.length > 0)
            return;
        for (const lane of SignalQueueConsumer.lanesForWorker()) {
            const consumer = new SignalQueueConsumer(this.supabase, this.tradeExecutor, lane);
            consumer.start();
            this.consumers.push(consumer);
        }
    }
    async stop() {
        await Promise.all(this.consumers.map(c => c.stop()));
        this.consumers = [];
    }
    async getMetrics() {
        return Promise.all(this.consumers.map(c => c.getMetrics()));
    }
}
exports.SignalQueueConsumerManager = SignalQueueConsumerManager;
