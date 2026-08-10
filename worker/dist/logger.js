"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const sentry_1 = require("./observability/sentry");
const LOG_LEVELS = { error: 0, warn: 1, info: 2 };
const CURRENT_LEVEL = process.env.LOGGER_LEVEL || 'info';
const SENTRY_MIN_LEVEL = LOG_LEVELS[process.env.SENTRY_LOGS_MIN_LEVEL] !== undefined
    ? process.env.SENTRY_LOGS_MIN_LEVEL
    : 'info';
const hasSpace = (v) => /[\s"]/.test(v);
const quote = (v) => {
    if (v === null || v === undefined)
        return 'null';
    if (typeof v === 'string')
        return hasSpace(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
    if (typeof v === 'object')
        return JSON.stringify(v);
    return String(v);
};
function log(level, tag, event, data) {
    if (LOG_LEVELS[level] > LOG_LEVELS[CURRENT_LEVEL])
        return;
    const parts = [`[${tag}]`, `level=${level}`, `event=${event}`];
    if (data) {
        for (const [k, v] of Object.entries(data)) {
            if (v === undefined)
                continue;
            parts.push(`${k}=${quote(v)}`);
        }
    }
    const line = parts.join(' ');
    if (level === 'error')
        console.error(line);
    else if (level === 'warn')
        console.warn(line);
    else
        console.log(line);
    if ((0, sentry_1.isWorkerSentryEnabled)() && LOG_LEVELS[level] <= LOG_LEVELS[SENTRY_MIN_LEVEL]) {
        (0, sentry_1.captureWorkerLog)(level, event, { subsystem: tag, operation: event, attributes: data });
    }
}
exports.logger = {
    info: (tag, event, data) => log('info', tag, event, data),
    warn: (tag, event, data) => log('warn', tag, event, data),
    error: (tag, event, data) => log('error', tag, event, data),
};
