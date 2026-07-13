"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishEntrySend = finishEntrySend;
exports.executeEntrySend = executeEntrySend;
const entryPrepare_1 = require("./entryPrepare");
const strictEntryPending_1 = require("./strictEntryPending");
const virtualPendingMaterialize_1 = require("./virtualPendingMaterialize");
const orderLegExecution_1 = require("./orderLegExecution");
async function finishEntrySend(prep, strictBrokerPlaced, materializedVirtuals, syncMultiLegTps, brokerPendingMode = false) {
    return (0, orderLegExecution_1.sendImmediateLegs)({
        ctx: prep.ctx,
        signal: prep.signal,
        parsed: prep.parsed,
        broker: prep.broker,
        manual: prep.manual,
        api: prep.api,
        uuid: prep.uuid,
        symbol: prep.symbol,
        requestedSymbol: prep.requestedSymbol,
        mapping: prep.mapping,
        params: prep.params,
        legs: prep.legs,
        liveEntryFast: prep.liveEntryFast,
        pipelineT0: prep.pipelineT0,
        strictEntryPrefetch: prep.strictEntryPrefetch,
        channelDelayMs: prep.channelDelayMs,
        channelDelaySkipped: prep.channelDelaySkipped,
        deferVirtualAnchor: prep.deferVirtualAnchor,
        deferBrokerRangePendingMaterialize: prep.deferBrokerRangePendingMaterialize,
        brokerPendingMode,
        prepAnchor: prep.anchor,
        prepAnchorSource: prep.anchorSource,
        virtualPendings: prep.virtualPendings,
        plan: prep.plan,
        materializedVirtuals,
        strictBrokerPlaced,
        strictDeferred: prep.strictDeferred,
        op: prep.op,
        channelKeywords: prep.channelKeywords,
        baseLot: prep.baseLot,
        syncMultiLegTps,
        prep,
    });
}
async function executeEntrySend(ctx, args, entryMode) {
    const prepared = await (0, entryPrepare_1.prepareEntryExecution)(ctx, args);
    if (!prepared.ok)
        return prepared.outcome;
    const prep = prepared.prep;
    const strictBrokerPlaced = await (0, strictEntryPending_1.placeStrictSignalEntryPending)(ctx, prep, entryMode === 'single');
    const materializedVirtuals = await (0, virtualPendingMaterialize_1.materializeVirtualPendingLegs)(ctx, prep, strictBrokerPlaced);
    return finishEntrySend(prep, strictBrokerPlaced, materializedVirtuals, entryMode === 'range');
}
