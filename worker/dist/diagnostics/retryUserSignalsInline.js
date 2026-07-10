"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Retry failed entry signals in-process (no worker HTTP needed).
 * Usage: npx ts-node -r dotenv/config src/diagnostics/retryUserSignalsInline.ts <user_id> <signal_id> [...]
 */
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const sessionManager_1 = require("../sessionManager");
const tradeExecutor_1 = require("../tradeExecutor");
const retrySignal_1 = require("../retrySignal");
const fxsocketClient_1 = require("../fxsocketClient");
const fxsocketMtStatus_1 = require("../fxsocketMtStatus");
async function main() {
    const userId = process.argv[2]?.trim();
    const signalIds = process.argv.slice(3).map(s => s.trim()).filter(Boolean);
    if (!userId || signalIds.length === 0) {
        console.error('usage: retryUserSignalsInline.ts <user_id> <signal_id> [signal_id...]');
        process.exit(1);
    }
    const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: broker } = await supabase
        .from('broker_accounts')
        .select('fxsocket_account_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
    const fxsId = broker?.fxsocket_account_id;
    if (fxsId) {
        try {
            const client = new fxsocketClient_1.FxsocketBrokerClient('MT5');
            const status = await client.mtStatus(fxsId, 'MT5');
            const failing = (0, fxsocketMtStatus_1.listFxsocketMtStatusChecks)(status).filter(c => !c.ok).map(c => c.id);
            console.log(JSON.stringify({ preflight: { status: status.status, tradeEaReady: status.bridge?.tradeEaReady, failing } }));
        }
        catch (e) {
            console.warn('preflight mtStatus failed:', e instanceof Error ? e.message : e);
        }
    }
    const sessionManager = new sessionManager_1.UserSessionManager(supabase);
    const executor = new tradeExecutor_1.TradeExecutor(supabase, sessionManager);
    await executor.start();
    try {
        for (const signalId of signalIds) {
            const result = await (0, retrySignal_1.retrySignal)(executor, { userId, signalId });
            console.log(JSON.stringify({ signalId, result }));
        }
    }
    finally {
        executor.stop();
    }
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
