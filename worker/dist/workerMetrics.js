"use strict";
/** Lightweight in-process counters for logs and /health (no external metrics stack required). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.incMetric = incMetric;
exports.observeMetric = observeMetric;
exports.getMetricsSnapshot = getMetricsSnapshot;
exports.resetMetricsForTest = resetMetricsForTest;
const counters = new Map();
function incMetric(name, delta = 1) {
    counters.set(name, (counters.get(name) ?? 0) + delta);
}
const DEFAULT_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
function observeMetric(name, value, buckets = DEFAULT_BUCKETS_MS) {
    if (!Number.isFinite(value) || value < 0)
        return;
    incMetric(`${name}_count`);
    incMetric(`${name}_sum`, value);
    for (const upper of buckets) {
        if (value <= upper) {
            incMetric(`${name}_bucket_le_${upper}`);
        }
    }
    incMetric(`${name}_bucket_le_+Inf`);
}
function getMetricsSnapshot() {
    return Object.fromEntries(counters.entries());
}
function resetMetricsForTest() {
    counters.clear();
}
