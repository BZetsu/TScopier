"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionEngine = void 0;
const fxContract_1 = require("./fxContract");
const basketStore_1 = require("./basketStore");
class ExecutionEngine {
    constructor(fx) {
        this.fx = fx;
    }
    async openBasket(args) {
        const operation = args.isBuy ? 'Buy' : 'Sell';
        // One snapshot for the whole burst: powers both idempotent skip and ambiguous recovery.
        const snapshot = await this.fx.openedOrders(args.accountId, args.platform).catch(() => []);
        const existingByComment = new Map();
        for (const o of snapshot) {
            if (o.comment)
                existingByComment.set(o.comment, o);
        }
        const opened = [];
        const failed = [];
        for (const leg of args.legs) {
            const comment = (0, fxContract_1.buildOrderComment)(args.anchorSignalId, leg.legIndex);
            // Idempotent skip: this leg already opened on a prior attempt.
            const already = existingByComment.get(comment);
            if (already) {
                opened.push({ legIndex: leg.legIndex, ticket: already.ticket, volume: already.volume, price: already.openPrice, adopted: true });
                await safeRecord(args, leg, already.ticket, already.volume, already.openPrice);
                continue;
            }
            const result = await this.fx.orderSend(args.accountId, args.platform, {
                symbol: args.brokerSymbol,
                operation,
                volume: leg.volume,
                stopLoss: leg.stopLoss ?? undefined,
                takeProfit: leg.takeProfit ?? undefined,
                comment,
            }, { anchorSignalId: args.anchorSignalId, legIndex: leg.legIndex, preSnapshot: snapshot });
            if (result.ok && result.ticket) {
                const adopted = result.retcodeName === 'DONE' && result.message.includes('adopted');
                opened.push({ legIndex: leg.legIndex, ticket: result.ticket, volume: result.volume ?? leg.volume, price: result.price, adopted });
                await safeRecord(args, leg, result.ticket, result.volume ?? leg.volume, result.price);
            }
            else {
                failed.push({ legIndex: leg.legIndex, reason: result.message, retcode: result.retcode });
            }
        }
        // Seed the desired-state (single source of truth) so reconciler + ladder agree.
        if ((args.desiredStopLoss != null && args.desiredStopLoss > 0) || (args.desiredTpLevels?.length ?? 0) > 0) {
            await seedDesired(args).catch(() => { });
        }
        return { opened, failed, fullyOpened: failed.length === 0 && opened.length === args.legs.length };
    }
}
exports.ExecutionEngine = ExecutionEngine;
async function safeRecord(args, leg, ticket, volume, price) {
    try {
        await args.recordTrade({
            ticket,
            legIndex: leg.legIndex,
            volume,
            price,
            stopLoss: leg.stopLoss ?? null,
            takeProfit: leg.takeProfit ?? null,
        });
    }
    catch (err) {
        // A failed trades-insert must not block the burst; the reconciler/orphan adoption
        // will pick up an opened-but-unrecorded leg from the broker snapshot.
        console.warn(`[executionEngine] recordTrade failed ticket=${ticket} leg=${leg.legIndex}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function seedDesired(args) {
    if (!args.supabase)
        return;
    await (0, basketStore_1.setDesiredBasket)(args.supabase, {
        userId: args.userId,
        brokerAccountId: args.brokerAccountId,
        anchorSignalId: args.anchorSignalId,
        channelId: args.channelId,
        symbol: args.brokerSymbol,
        stoploss: args.desiredStopLoss ?? null,
        tpLevels: args.desiredTpLevels ?? null,
        source: 'entry',
        instructionAt: args.instructionAt ?? null,
    });
}
