"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSingleEntry = runSingleEntry;
const entryExecution_1 = require("./entryExecution");
async function runSingleEntry(ctx, args) {
    return (0, entryExecution_1.executeEntrySend)(ctx, args, 'single');
}
