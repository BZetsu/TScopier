"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChannelSignalExamples = loadChannelSignalExamples;
exports.formatExamplesForPrompt = formatExamplesForPrompt;
exports.upsertChannelSignalExample = upsertChannelSignalExample;
const node_crypto_1 = require("node:crypto");
const coerceTradeIntent_1 = require("./coerceTradeIntent");
function messageHash(rawMessage) {
    return (0, node_crypto_1.createHash)('sha256').update(rawMessage.trim()).digest('hex').slice(0, 32);
}
async function loadChannelSignalExamples(supabase, channelRowId, limit = 12) {
    // Manual examples use sort_order 0–99; auto examples start at 100.
    const { data, error } = await supabase
        .from('channel_signal_examples')
        .select('raw_message,label,intent')
        .eq('channel_id', channelRowId)
        .order('sort_order', { ascending: true })
        .limit(limit);
    if (error || !data?.length)
        return [];
    return data.map(row => {
        const r = row;
        const labelRaw = String(r.label ?? 'entry').toLowerCase();
        const label = labelRaw === 'update' || labelRaw === 'ignore' ? labelRaw : 'entry';
        return {
            raw_message: String(r.raw_message ?? ''),
            label,
            intent: (0, coerceTradeIntent_1.coerceTradeIntent)(r.intent),
        };
    });
}
function formatExamplesForPrompt(examples) {
    return examples.map(ex => ({
        raw_message: ex.raw_message,
        label: ex.label,
        intent: ex.intent,
    }));
}
async function upsertChannelSignalExample(supabase, input) {
    await supabase.from('channel_signal_examples').upsert({
        channel_id: input.channelId,
        user_id: input.userId,
        raw_message: input.rawMessage,
        raw_message_hash: messageHash(input.rawMessage),
        label: input.label,
        intent: input.intent,
        source: input.source ?? 'manual',
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id,raw_message_hash' });
}
