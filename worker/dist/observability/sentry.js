"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafePipelineContext = exports.safeForSentry = void 0;
exports.isValidSentryDsn = isValidSentryDsn;
exports.isWorkerSentryEnabled = isWorkerSentryEnabled;
exports.setSentryAdapterForTests = setSentryAdapterForTests;
exports.resetWorkerSentryForTests = resetWorkerSentryForTests;
exports.initWorkerSentry = initWorkerSentry;
exports.setWorkerGlobalTags = setWorkerGlobalTags;
exports.captureWorkerError = captureWorkerError;
exports.captureWorkerWarning = captureWorkerWarning;
exports.captureWorkerMessage = captureWorkerMessage;
exports.captureWorkerLog = captureWorkerLog;
exports.addWorkerBreadcrumb = addWorkerBreadcrumb;
exports.flushWorkerSentry = flushWorkerSentry;
exports.captureWorkerFatalError = captureWorkerFatalError;
exports.handleWorkerUncaughtException = handleWorkerUncaughtException;
exports.handleWorkerUnhandledRejection = handleWorkerUnhandledRejection;
exports.installWorkerProcessSentryHandlers = installWorkerProcessSentryHandlers;
exports.removeWorkerProcessSentryHandlersForTests = removeWorkerProcessSentryHandlersForTests;
const Sentry = __importStar(require("@sentry/node"));
const workerConfig_1 = require("../workerConfig");
const brokerExecutionMode_1 = require("../brokerExecutionMode");
const sentryRedaction_1 = require("./sentryRedaction");
Object.defineProperty(exports, "safeForSentry", { enumerable: true, get: function () { return sentryRedaction_1.safeForSentry; } });
const sentryContext_1 = require("./sentryContext");
Object.defineProperty(exports, "buildSafePipelineContext", { enumerable: true, get: function () { return sentryContext_1.buildSafePipelineContext; } });
let sentry = Sentry;
let enabled = false;
let initialized = false;
let processHandlersInstalled = false;
let fatalCaptureInFlight = false;
let uncaughtHandler = null;
let rejectionHandler = null;
let invalidDsnWarningEmitted = false;
const fatalErrors = new WeakSet();
const fatalSignatures = new Map();
const ALLOWED_BREADCRUMB_CATEGORIES = new Set([
    'account',
    'auth',
    'broker',
    'copier',
    'layering',
    'management',
    'persistence',
    'queue',
    'range',
    'reconciliation',
    'trade',
    'telegram',
    'worker',
]);
const ALLOWED_BREADCRUMB_LEVELS = new Set(['debug', 'info', 'warning', 'error']);
function envBool(raw) {
    return String(raw ?? '').trim().toLowerCase() === 'true';
}
function hasWhitespaceOrControl(value) {
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        if (code <= 32 || code === 127)
            return true;
    }
    return false;
}
function isValidSentryDsn(value) {
    try {
        if (typeof value !== 'string')
            return false;
        const trimmed = value.trim();
        if (!trimmed || trimmed !== value)
            return false;
        if (hasWhitespaceOrControl(value))
            return false;
        if (/%(?![0-9A-Fa-f]{2})/.test(value))
            return false;
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return false;
        if (!url.hostname)
            return false;
        if (!url.username)
            return false;
        if (url.password)
            return false;
        if (url.hash)
            return false;
        if (url.search)
            return false;
        const publicKey = decodeURIComponent(url.username);
        if (!/^[A-Za-z0-9_-]+$/.test(publicKey))
            return false;
        const pathParts = url.pathname.split('/').filter(Boolean);
        const projectId = pathParts.at(-1);
        if (!projectId || !/^\d+$/.test(projectId))
            return false;
        return true;
    }
    catch {
        return false;
    }
}
function warnInvalidDsnOnce() {
    if (invalidDsnWarningEmitted)
        return;
    invalidDsnWarningEmitted = true;
    console.warn('[sentry] disabled: invalid DSN configuration');
}
function safeName(value, fallback) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 80);
    return normalized || fallback;
}
function releaseFromEnv(env) {
    return String(env.SENTRY_RELEASE
        ?? env.RAILWAY_GIT_COMMIT_SHA
        ?? env.RAILWAY_DEPLOYMENT_ID
        ?? workerConfig_1.WORKER_BUILD_TAG).trim();
}
function environmentFromEnv(env) {
    return String(env.SENTRY_ENVIRONMENT ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? 'production')
        .trim()
        .toLowerCase();
}
function isWorkerSentryEnabled() {
    return enabled;
}
function setSentryAdapterForTests(adapter) {
    sentry = adapter;
}
function resetWorkerSentryForTests() {
    enabled = false;
    initialized = false;
    processHandlersInstalled = false;
    fatalCaptureInFlight = false;
    uncaughtHandler = null;
    rejectionHandler = null;
    invalidDsnWarningEmitted = false;
    fatalSignatures.clear();
    logNoiseEnabled = true;
    logNoisePatterns = [...DEFAULT_LOG_NOISE_PATTERNS];
    sentry = Sentry;
}
function sanitizeTags(tags) {
    const safe = (0, sentryRedaction_1.safeForSentry)(tags);
    if (!safe || typeof safe !== 'object' || Array.isArray(safe))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(safe).slice(0, 20)) {
        out[safeName(key, 'tag')] = String(value ?? '').slice(0, 160);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
function sanitizeEvent(event) {
    const safe = (0, sentryRedaction_1.safeForSentry)(event);
    if (!safe || typeof safe !== 'object' || Array.isArray(safe)) {
        return { message: String((0, sentryRedaction_1.safeForSentry)(String(safe ?? 'event'))), level: 'error' };
    }
    const src = safe;
    const out = {};
    for (const key of ['event_id', 'timestamp', 'platform', 'level', 'logger', 'release', 'environment', 'message']) {
        if (src[key] !== undefined)
            out[key] = src[key];
    }
    if (Array.isArray(src.fingerprint))
        out.fingerprint = src.fingerprint.slice(0, 5).map(v => String(v).slice(0, 120));
    const tags = sanitizeTags(src.tags);
    if (tags)
        out.tags = tags;
    const contexts = src.contexts;
    if (contexts && typeof contexts === 'object' && !Array.isArray(contexts)) {
        const c = contexts;
        out.contexts = {
            pipeline: c.pipeline,
            worker: c.worker,
            durations: c.durations,
        };
    }
    const extra = src.extra;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        const e = extra;
        out.extra = e.safe_extra !== undefined ? { safe_extra: e.safe_extra } : undefined;
    }
    if (Array.isArray(src.breadcrumbs))
        out.breadcrumbs = src.breadcrumbs.slice(-25);
    if (src.exception !== undefined)
        out.exception = src.exception;
    return out;
}
function beforeSend(event) {
    return sanitizeEvent(event);
}
function beforeBreadcrumb(breadcrumb) {
    const safe = (0, sentryRedaction_1.safeForSentry)(breadcrumb);
    if (safe && typeof safe === 'object' && !Array.isArray(safe)) {
        const crumb = safe;
        const category = safeName(String(crumb.category ?? ''), 'worker');
        const level = ALLOWED_BREADCRUMB_LEVELS.has(String(crumb.level)) ? String(crumb.level) : 'info';
        if (!ALLOWED_BREADCRUMB_CATEGORIES.has(category)) {
            return { category: 'worker', message: '[REDACTED_BREADCRUMB]', level };
        }
        return {
            category,
            message: String((0, sentryRedaction_1.safeForSentry)(String(crumb.message ?? ''))).slice(0, 240),
            level,
            data: (0, sentryRedaction_1.safeForSentry)(crumb.data),
        };
    }
    return { category: 'worker', message: '[REDACTED_BREADCRUMB]', level: 'info' };
}
/**
 * High-frequency log lines with no diagnostic value that would otherwise flood
 * Sentry Logs. The dominant case is gramjs/Telegram rate-limit chatter
 * (`Sleeping for Ns on flood wait ...`) — in the Aug 9/10 prod windows it made
 * up ~60-67% of all captured log lines. Each entry is a RegExp tested against
 * the raw message; a match drops the log (returns null from beforeSendLog).
 * Extra patterns can be added via SENTRY_LOG_NOISE_PATTERNS (comma-separated
 * regex sources) and the filter can be disabled entirely with
 * SENTRY_LOG_NOISE_FILTER=false.
 */
const DEFAULT_LOG_NOISE_PATTERNS = [
    /sleeping for \d+\s*s\s*on flood wait\s*\(caused by messages\./i,
];
function compileLogNoisePatterns(env) {
    const patterns = [...DEFAULT_LOG_NOISE_PATTERNS];
    const raw = String(env.SENTRY_LOG_NOISE_PATTERNS ?? '').trim();
    if (raw) {
        for (const src of raw.split(',')) {
            const s = src.trim();
            if (!s)
                continue;
            try {
                patterns.push(new RegExp(s, 'i'));
            }
            catch {
                // Ignore an invalid extra pattern; defaults still apply.
            }
        }
    }
    return patterns;
}
let logNoiseEnabled = true;
let logNoisePatterns = [...DEFAULT_LOG_NOISE_PATTERNS];
function beforeSendLog(log) {
    const safe = (0, sentryRedaction_1.safeForSentry)(log);
    if (!safe || typeof safe !== 'object' || Array.isArray(safe))
        return null;
    const src = safe;
    const message = src.message;
    if (typeof message !== 'string')
        return null;
    if (logNoiseEnabled && logNoisePatterns.some(p => p.test(message)))
        return null;
    const attributes = src.attributes;
    return {
        level: src.level ?? 'info',
        message: String(message).slice(0, 512),
        attributes: attributes && typeof attributes === 'object' && !Array.isArray(attributes)
            ? (0, sentryRedaction_1.safeForSentry)(attributes)
            : undefined,
    };
}
function initWorkerSentry(env = process.env) {
    if (initialized)
        return;
    initialized = true;
    try {
        if (!envBool(env.SENTRY_ENABLED))
            return;
        if (envBool(env.LOAD_TEST_MODE) && !envBool(env.SENTRY_LOAD_TEST_ENABLED))
            return;
        const dsn = String(env.SENTRY_DSN ?? '');
        if (!dsn)
            return;
        if (!isValidSentryDsn(dsn)) {
            warnInvalidDsnOnce();
            return;
        }
        logNoiseEnabled = String(env.SENTRY_LOG_NOISE_FILTER ?? '').trim().toLowerCase() !== 'false';
        logNoisePatterns = compileLogNoisePatterns(env);
        sentry.init({
            dsn,
            enabled: true,
            environment: environmentFromEnv(env),
            release: releaseFromEnv(env),
            defaultIntegrations: false,
            integrations: [Sentry.consoleLoggingIntegration()],
            tracesSampleRate: 0,
            profilesSampleRate: 0,
            skipOpenTelemetrySetup: true,
            tracePropagationTargets: [],
            sendDefaultPii: false,
            maxBreadcrumbs: 50,
            enableLogs: true,
            beforeSend: beforeSend,
            beforeBreadcrumb: beforeBreadcrumb,
            beforeSendLog: beforeSendLog,
        });
        enabled = true;
        setWorkerGlobalTags(env);
    }
    catch (err) {
        enabled = false;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[sentry] disabled after initialization failure: ${String(msg).slice(0, 180)}`);
    }
}
function setWorkerGlobalTags(env = process.env) {
    if (!enabled)
        return;
    try {
        const capability = (0, brokerExecutionMode_1.getBrokerExecutionCapability)();
        const tags = {
            'worker.role': workerConfig_1.workerConfig.role,
            'worker.shard_id': String(workerConfig_1.workerConfig.shardId),
            'worker.shard_count': String(workerConfig_1.workerConfig.shardCount),
            node_env: String(env.NODE_ENV ?? 'production'),
            'railway.environment': String(env.RAILWAY_ENVIRONMENT_NAME ?? ''),
            broker_mode: capability.broker_mode,
            execution_engine: String(env.EXECUTION_ENGINE ?? 'v1'),
            load_test: envBool(env.LOAD_TEST_MODE) ? 'true' : 'false',
        };
        for (const [key, value] of Object.entries(tags))
            sentry.setTag(safeName(key, 'tag'), String((0, sentryRedaction_1.safeForSentry)(value)).slice(0, 160));
        sentry.setContext('worker', (0, sentryRedaction_1.safeForSentry)({
            instance_id: workerConfig_1.workerConfig.instanceId,
            build_tag: workerConfig_1.WORKER_BUILD_TAG,
            shard_id: workerConfig_1.workerConfig.shardId,
            shard_count: workerConfig_1.workerConfig.shardCount,
            role: workerConfig_1.workerConfig.role,
        }));
    }
    catch {
        // Sentry must never affect worker startup or execution.
    }
}
function applyScope(scope, opts) {
    const s = scope;
    s.setLevel?.(opts.level ?? 'error');
    s.setTag?.('subsystem', safeName(opts.subsystem, 'unknown'));
    s.setTag?.('operation', safeName(opts.operation, 'unknown'));
    const errorCode = opts.errorCode ?? 'UNKNOWN';
    s.setTag?.('error_code', safeName(errorCode, 'UNKNOWN').toUpperCase());
    if (opts.tags) {
        for (const [key, value] of Object.entries(opts.tags)) {
            if (value == null)
                continue;
            s.setTag?.(safeName(key, 'tag'), String((0, sentryRedaction_1.safeForSentry)(value)).slice(0, 160));
        }
    }
    s.setContext?.('pipeline', (0, sentryContext_1.buildSafePipelineContext)({
        ...(opts.context ?? {}),
        stage: opts.context?.stage ?? opts.operation,
    }));
    if (opts.extra)
        s.setExtra?.('safe_extra', (0, sentryRedaction_1.safeForSentry)(opts.extra));
    s.setFingerprint?.((opts.fingerprint ?? [opts.subsystem, errorCode, opts.operation])
        .slice(0, 5)
        .map(part => safeName(part, 'unknown')));
}
function captureWorkerError(err, opts) {
    if (!enabled)
        return;
    try {
        const errorCode = opts.errorCode ?? (0, sentryRedaction_1.normalizedErrorCode)(err);
        sentry.withScope(scope => {
            applyScope(scope, { ...opts, level: 'error', errorCode });
            sentry.captureException(err instanceof Error ? err : new Error(String(err ?? 'unknown error')));
        });
    }
    catch {
        // Capture failures must not alter trade outcomes.
    }
}
function captureWorkerWarning(messageOrError, opts) {
    if (!enabled)
        return;
    try {
        const errorCode = opts.errorCode ?? (0, sentryRedaction_1.normalizedErrorCode)(messageOrError, 'WARNING');
        sentry.withScope(scope => {
            applyScope(scope, { ...opts, level: 'warning', errorCode });
            if (messageOrError instanceof Error)
                sentry.captureException(messageOrError);
            else
                sentry.captureMessage(String((0, sentryRedaction_1.safeForSentry)(String(messageOrError ?? 'warning'))), 'warning');
        });
    }
    catch {
        // best-effort only
    }
}
function captureWorkerMessage(message, opts) {
    if (!enabled)
        return;
    try {
        const errorCode = opts.errorCode ?? 'MESSAGE';
        sentry.withScope(scope => {
            applyScope(scope, { ...opts, errorCode });
            sentry.captureMessage(String((0, sentryRedaction_1.safeForSentry)(message)).slice(0, 240), opts.level ?? 'warning');
        });
    }
    catch {
        // best-effort only
    }
}
function captureWorkerLog(level, message, opts) {
    if (!enabled)
        return;
    try {
        const attributes = {
            subsystem: safeName(opts.subsystem, 'unknown'),
            operation: safeName(opts.operation, 'unknown'),
        };
        if (opts.errorCode)
            attributes.error_code = safeName(opts.errorCode, 'UNKNOWN').toUpperCase();
        const tags = sanitizeTags(opts.tags);
        if (tags)
            Object.assign(attributes, tags);
        if (opts.attributes && typeof opts.attributes === 'object' && !Array.isArray(opts.attributes)) {
            const safeAttributes = (0, sentryRedaction_1.safeForSentry)(opts.attributes);
            if (safeAttributes && typeof safeAttributes === 'object' && !Array.isArray(safeAttributes)) {
                Object.assign(attributes, safeAttributes);
            }
        }
        const safeMessage = String((0, sentryRedaction_1.safeForSentry)(message)).slice(0, 512);
        const log = sentry.logger;
        if (level === 'info')
            log.info(safeMessage, attributes);
        else if (level === 'warn')
            log.warn(safeMessage, attributes);
        else
            log.error(safeMessage, attributes);
    }
    catch {
        // best-effort only
    }
}
function addWorkerBreadcrumb(args) {
    if (!enabled)
        return;
    try {
        sentry.addBreadcrumb(beforeBreadcrumb({
            category: args.category,
            message: args.message,
            level: args.level ?? 'info',
            data: args.data,
        }));
    }
    catch {
        // best-effort only
    }
}
async function flushWorkerSentry(timeoutMs = 1800) {
    if (!enabled)
        return false;
    try {
        return await sentry.flush(Math.max(0, Math.min(2000, timeoutMs)));
    }
    catch {
        return false;
    }
}
function rejectionToError(reason) {
    return reason instanceof Error ? reason : new Error(String(reason ?? 'unhandled rejection'));
}
function captureWorkerFatalError(err, opts) {
    const objectErr = err && typeof err === 'object' ? err : null;
    if (objectErr && fatalErrors.has(objectErr))
        return false;
    const signature = [
        opts.subsystem,
        opts.operation,
        opts.errorCode ?? (0, sentryRedaction_1.normalizedErrorCode)(err),
        err instanceof Error ? err.name : typeof err,
        err instanceof Error ? err.message : String(err ?? ''),
    ].join('|');
    const now = Date.now();
    const previous = fatalSignatures.get(signature) ?? 0;
    if (now - previous < 2000)
        return false;
    if (objectErr)
        fatalErrors.add(objectErr);
    fatalSignatures.set(signature, now);
    captureWorkerError(err, opts);
    return true;
}
function handleWorkerUncaughtException(err) {
    if (fatalCaptureInFlight) {
        process.exit(1);
        return;
    }
    fatalCaptureInFlight = true;
    captureWorkerFatalError(err, {
        subsystem: 'worker',
        operation: 'uncaught_exception',
        errorCode: 'UNCAUGHT_EXCEPTION',
        fingerprint: ['worker', 'UNCAUGHT_EXCEPTION', err.name || 'Error'],
    });
    void flushWorkerSentry(1800).finally(() => process.exit(1));
}
function handleWorkerUnhandledRejection(reason) {
    if (fatalCaptureInFlight)
        return;
    fatalCaptureInFlight = true;
    const err = rejectionToError(reason);
    captureWorkerFatalError(err, {
        subsystem: 'worker',
        operation: 'unhandled_rejection',
        errorCode: 'UNHANDLED_REJECTION',
        fingerprint: ['worker', 'UNHANDLED_REJECTION', err.name || 'Error'],
    });
    void flushWorkerSentry(1800).finally(() => process.exit(1));
}
function installWorkerProcessSentryHandlers() {
    if (processHandlersInstalled)
        return;
    processHandlersInstalled = true;
    uncaughtHandler = err => handleWorkerUncaughtException(err);
    rejectionHandler = reason => handleWorkerUnhandledRejection(reason);
    process.on('uncaughtException', uncaughtHandler);
    process.on('unhandledRejection', rejectionHandler);
}
function removeWorkerProcessSentryHandlersForTests() {
    if (uncaughtHandler)
        process.off('uncaughtException', uncaughtHandler);
    if (rejectionHandler)
        process.off('unhandledRejection', rejectionHandler);
    uncaughtHandler = null;
    rejectionHandler = null;
    processHandlersInstalled = false;
}
