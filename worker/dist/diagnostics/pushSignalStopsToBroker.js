"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Emergency: push signal SL/TP to live broker positions via OrderModify.
 *
 * Railway / production (after npm run build):
 *   node -r dotenv/config dist/diagnostics/pushSignalStopsToBroker.js
 *
 * Local:
 *   cd worker && npm run build && npm run push-signal-stops
 *
 * Env:
 *   SIGNAL_ID          — optional; defaults to latest buy/sell with parsed SL today
 *   SINCE_ISO          — optional; only open trades opened after this (default: signal time - 2m)
 *   DRY_RUN=true       — print plan only, no broker calls
 *   ALL_CHANNELS=true  — apply to all open trades since SINCE (ignore signal channel filter)
 *   SYMBOL_PREFIX      — optional symbol filter (default: signal symbol or XAU)
 *   SL_ONLY=true       — modify stoploss only; leave each leg's TP unchanged on broker + DB
 *   PUSH_SL_ONLY=true  — alias for SL_ONLY
 *   SL_FROM=channel    — SL source: channel (default) | signal | trade
 *   SL_OVERRIDE=4319   — optional explicit SL (overrides SL_FROM)
 *   TP_ONLY=true       — modify takeprofit only; leave SL unchanged per leg
 */
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const fxsocketClient_1 = require("../fxsocketClient");
const helpers_1 = require("../tradeExecutor/helpers");
const tpBucketDistribution_1 = require("../manualPlanning/tpBucketDistribution");
const channelActiveTradeParams_1 = require("../channelActiveTradeParams");
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
function num(v) {
    if (v == null)
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
async function resolveTargetSl(args) {
    const override = num(process.env.SL_OVERRIDE);
    if (override != null)
        return override;
    const parsed = (args.signal.parsed_data ?? {});
    const parsedSl = num(parsed.sl);
    const channelId = args.channelId ?? args.signal.channel_id;
    const tryChannel = async () => {
        if (!channelId)
            return null;
        const ch = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(supabase, args.signal.user_id, channelId, args.symbol);
        return ch?.stoploss != null ? num(ch.stoploss) : null;
    };
    if (args.slFrom === 'trade') {
        const fromTrade = num(args.tradeSl);
        if (fromTrade != null)
            return fromTrade;
        const fromCh = await tryChannel();
        if (fromCh != null)
            return fromCh;
        if (parsedSl != null)
            return parsedSl;
    }
    if (args.slFrom === 'signal') {
        if (parsedSl != null)
            return parsedSl;
        const fromCh = await tryChannel();
        if (fromCh != null)
            return fromCh;
    }
    // default: channel first (catches SL adjustments like 4319 after initial 4321)
    const fromCh = await tryChannel();
    if (fromCh != null)
        return fromCh;
    if (parsedSl != null)
        return parsedSl;
    const fromTrade = num(args.tradeSl);
    if (fromTrade != null)
        return fromTrade;
    throw new Error('No SL — set SL_OVERRIDE, channel_active_trade_params, or SIGNAL_ID with parsed SL');
}
async function resolveTpLadder(signal, symbol) {
    const parsed = (signal.parsed_data ?? {});
    let tps = (parsed.tp ?? []).map(t => num(t)).filter((t) => t != null);
    if (!tps.length && signal.channel_id) {
        const ch = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(supabase, signal.user_id, signal.channel_id, symbol);
        if (ch?.tpLevels?.length)
            tps = ch.tpLevels;
    }
    if (!tps.length)
        throw new Error('No TP ladder — set SIGNAL_ID with parsed TPs or channel_active_trade_params');
    return { tps };
}
function parseSlFrom() {
    const raw = String(process.env.SL_FROM ?? 'channel').trim().toLowerCase();
    if (raw === 'signal' || raw === 'trade')
        return raw;
    return 'channel';
}
async function resolveSignalId() {
    const pinned = String(process.env.SIGNAL_ID ?? '').trim();
    if (pinned)
        return pinned;
    const { data, error } = await supabase
        .from('signals')
        .select('id')
        .in('status', ['executed', 'parsed'])
        .filter('parsed_data->>sl', 'neq', '')
        .order('created_at', { ascending: false })
        .limit(20);
    if (error)
        throw error;
    for (const row of data ?? []) {
        const { data: sig } = await supabase
            .from('signals')
            .select('id,parsed_data')
            .eq('id', row.id)
            .maybeSingle();
        const action = String(sig?.parsed_data?.action ?? '').toLowerCase();
        const sl = num(sig?.parsed_data?.sl);
        if ((action === 'buy' || action === 'sell') && sl != null)
            return row.id;
    }
    throw new Error('No entry signal with parsed SL found — set SIGNAL_ID');
}
async function main() {
    const dryRun = String(process.env.DRY_RUN ?? '').toLowerCase() === 'true';
    const slOnly = String(process.env.SL_ONLY ?? process.env.PUSH_SL_ONLY ?? '').toLowerCase() === 'true';
    const tpOnly = String(process.env.TP_ONLY ?? '').toLowerCase() === 'true';
    const slFrom = parseSlFrom();
    if (!dryRun && !(0, fxsocketClient_1.hasFxsocketConfigured)()) {
        throw new Error('FXSOCKET_API_KEY not set — cannot call broker');
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    const signalId = await resolveSignalId();
    const { data: signal, error: sigErr } = await supabase
        .from('signals')
        .select('id,channel_id,user_id,created_at,parsed_data')
        .eq('id', signalId)
        .maybeSingle();
    if (sigErr || !signal)
        throw sigErr ?? new Error(`signal not found: ${signalId}`);
    const parsed = (signal.parsed_data ?? {});
    const symbolPrefix = String(process.env.SYMBOL_PREFIX ?? parsed.symbol ?? 'XAU').trim().toUpperCase();
    const signalTps = slOnly ? [] : (await resolveTpLadder(signal, symbolPrefix)).tps;
    const sinceIso = process.env.SINCE_ISO?.trim()
        || new Date(new Date(signal.created_at).getTime() - 2 * 60000).toISOString();
    const allChannels = String(process.env.ALL_CHANNELS ?? 'true').toLowerCase() === 'true';
    console.log(`Signal ${signalId}`);
    if (slOnly) {
        console.log(`  mode=SL_ONLY  SL_FROM=${slFrom}`);
    }
    else if (tpOnly) {
        console.log(`  mode=TP_ONLY  TPs=${signalTps.join(',')}`);
    }
    else {
        console.log(`  SL_FROM=${slFrom}  TPs=${signalTps.join(',')}`);
    }
    console.log(`  channel=${signal.channel_id}  since=${sinceIso}`);
    console.log(`  dryRun=${dryRun}\n`);
    let tradesQ = supabase
        .from('trades')
        .select('id,signal_id,broker_account_id,metaapi_order_id,symbol,direction,sl,tp,opened_at,entry_price,telegram_channel_id')
        .eq('status', 'open')
        .gte('opened_at', sinceIso)
        .not('metaapi_order_id', 'is', null)
        .order('opened_at', { ascending: true });
    if (!allChannels && signal.channel_id) {
        tradesQ = tradesQ.eq('telegram_channel_id', signal.channel_id);
    }
    if (symbolPrefix) {
        tradesQ = tradesQ.ilike('symbol', `${symbolPrefix}%`);
    }
    const { data: trades, error: trErr } = await tradesQ;
    if (trErr)
        throw trErr;
    const rows = (trades ?? []);
    if (!rows.length) {
        console.log('No open trades matched — widen SINCE_ISO or check channel_id');
        return;
    }
    const brokerIds = [...new Set(rows.map(r => r.broker_account_id))];
    const { data: brokers } = await supabase
        .from('broker_accounts')
        .select('id,label,platform,fxsocket_account_id,metaapi_account_id,manual_settings')
        .in('id', brokerIds);
    const brokerById = new Map((brokers ?? []).map(b => [b.id, b]));
    const api = (0, fxsocketClient_1.getFxsocketClient)();
    let modified = 0;
    let failed = 0;
    let skipped = 0;
    for (const brokerId of brokerIds) {
        const broker = brokerById.get(brokerId);
        const uuid = broker ? (0, helpers_1.brokerSessionUuid)(broker) : null;
        if (!broker || !uuid) {
            console.warn(`SKIP broker ${brokerId}: no FxSocket session id`);
            skipped += rows.filter(r => r.broker_account_id === brokerId).length;
            continue;
        }
        const client = api;
        if (!client && !dryRun) {
            console.warn('SKIP all: FXSOCKET client unavailable');
            break;
        }
        const platform = (0, fxsocketClient_1.mtPlatformFrom)(broker.platform);
        client?.seedPlatformCache(uuid, platform);
        const legs = rows
            .filter(r => r.broker_account_id === brokerId)
            .sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
        const tpLots = broker.manual_settings?.tp_lots ?? null;
        const isBuy = String(legs[0]?.direction ?? '').toLowerCase() === 'buy';
        const tpMap = slOnly || tpOnly
            ? new Map()
            : (0, tpBucketDistribution_1.buildEntryQualityTakeProfitMap)({
                legs: legs.map(tr => ({
                    id: tr.id,
                    entryPrice: Number(tr.entry_price ?? 0),
                    openedAt: tr.opened_at,
                })),
                isBuy,
                slotLegCount: legs.length,
                finalTps: signalTps,
                tpLots: tpLots ?? null,
            });
        console.log(`\n${broker.label ?? brokerId} (${broker.platform}) — ${legs.length} leg(s)`);
        const slCache = new Map();
        for (let i = 0; i < legs.length; i++) {
            const tr = legs[i];
            const ticket = Number(tr.metaapi_order_id);
            if (!Number.isFinite(ticket) || ticket <= 0) {
                skipped++;
                continue;
            }
            const keepTp = num(tr.tp);
            const keepSl = num(tr.sl);
            const targetTp = tpOnly ? (tpMap.get(tr.id) ?? keepTp) : slOnly ? keepTp : (tpMap.get(tr.id) ?? keepTp);
            let targetSl = tpOnly ? keepSl : null;
            if (!tpOnly) {
                const chKey = `${tr.telegram_channel_id ?? signal.channel_id ?? ''}|${tr.symbol}|${slFrom}`;
                const cached = slCache.get(chKey);
                if (cached != null) {
                    targetSl = cached;
                }
                else {
                    targetSl = await resolveTargetSl({
                        signal,
                        symbol: tr.symbol,
                        slFrom,
                        tradeSl: tr.sl,
                        channelId: tr.telegram_channel_id ?? signal.channel_id,
                    });
                    slCache.set(chKey, targetSl);
                }
            }
            if (targetSl == null && !tpOnly) {
                skipped++;
                continue;
            }
            if (!slOnly && !tpOnly && (targetTp == null || !(targetTp > 0))) {
                skipped++;
                continue;
            }
            const slLabel = targetSl != null ? targetSl : '—';
            const tpLabel = targetTp != null ? targetTp : '—';
            console.log(`  leg ${i + 1}/${legs.length} ticket=${ticket} ${tr.symbol}`
                + ` → SL=${slLabel} TP=${tpLabel}${slOnly ? ' (TP unchanged)' : ''}`);
            if (dryRun)
                continue;
            try {
                const modifyArgs = { ticket };
                if (!tpOnly && targetSl != null && targetSl > 0)
                    modifyArgs.stoploss = targetSl;
                if (!slOnly && targetTp != null && targetTp > 0)
                    modifyArgs.takeprofit = targetTp;
                if (modifyArgs.stoploss == null && modifyArgs.takeprofit == null) {
                    skipped++;
                    continue;
                }
                await client.orderModify(uuid, modifyArgs);
                const dbPatch = {};
                if (!tpOnly && targetSl != null)
                    dbPatch.sl = targetSl;
                if (!slOnly && targetTp != null)
                    dbPatch.tp = targetTp;
                if (Object.keys(dbPatch).length > 0) {
                    await supabase.from('trades').update(dbPatch).eq('id', tr.id);
                }
                await supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signalId,
                    broker_account_id: brokerId,
                    action: 'mgmt_modify',
                    status: 'success',
                    request_payload: {
                        ticket,
                        action: 'modify',
                        target_sl: modifyArgs.stoploss ?? null,
                        target_tp: modifyArgs.takeprofit ?? null,
                        manual_push: true,
                        sl_only: slOnly,
                        tp_only: tpOnly,
                        sl_from: slFrom,
                        trade_id: tr.id,
                    },
                });
                modified++;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`    FAILED: ${msg}`);
                failed++;
                try {
                    await supabase.from('trade_execution_logs').insert({
                        user_id: signal.user_id,
                        signal_id: signalId,
                        broker_account_id: brokerId,
                        action: 'mgmt_modify',
                        status: 'failed',
                        error_message: msg,
                        request_payload: { ticket, manual_push: true, trade_id: tr.id },
                    });
                }
                catch { /* best-effort */ }
            }
        }
    }
    console.log(`\nDone: modified=${modified} failed=${failed} skipped=${skipped}`);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
