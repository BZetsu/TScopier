"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistListenerEvent = persistListenerEvent;
const workerMetrics_1 = require("./workerMetrics");
async function persistListenerEvent(supabase, args) {
    (0, workerMetrics_1.incMetric)(`listener_event_${args.eventType}`);
    const { error } = await supabase.from('listener_events').insert({
        user_id: args.userId,
        channel_row_id: args.channelRowId ?? null,
        telegram_message_id: args.telegramMessageId ?? null,
        event_type: args.eventType,
        detail: args.detail ?? {},
    });
    if (error) {
        console.warn(`[listenerEvents] insert failed type=${args.eventType} user=${args.userId}:`, error.message);
    }
}
