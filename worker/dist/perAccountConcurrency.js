"use strict";
/**
 * Per-key concurrency gate.
 *
 * An MT4/MT5 terminal executes trade operations serially; firing many
 * OrderSend/OrderModify/OrderClose at one terminal in parallel makes the bridge
 * queue them and return "timed out". This gate bounds the number of in-flight
 * operations per account (key) regardless of how wide callers parallelize, so a
 * single terminal is never overwhelmed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConcurrencyGate = createConcurrencyGate;
exports.runWithAccountLimit = runWithAccountLimit;
function createConcurrencyGate() {
    const slots = new Map();
    async function acquire(key, limit) {
        const max = Math.max(1, Math.floor(limit) || 1);
        let slot = slots.get(key);
        if (!slot) {
            slot = { active: 0, queue: [] };
            slots.set(key, slot);
        }
        const s = slot;
        if (s.active < max) {
            s.active += 1;
        }
        else {
            // Wait for a slot to be handed off (active is kept on handoff, not ++'d).
            await new Promise(resolve => s.queue.push(resolve));
        }
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            const next = s.queue.shift();
            if (next) {
                next(); // hand our slot directly to the next waiter; active unchanged
            }
            else {
                s.active -= 1;
                if (s.active <= 0 && s.queue.length === 0)
                    slots.delete(key);
            }
        };
    }
    function activeCount(key) {
        return slots.get(key)?.active ?? 0;
    }
    return { acquire, activeCount };
}
/** Run `fn` while holding a concurrency slot for `key`. */
async function runWithAccountLimit(gate, key, limit, fn) {
    const release = await gate.acquire(key, limit);
    try {
        return await fn();
    }
    finally {
        release();
    }
}
