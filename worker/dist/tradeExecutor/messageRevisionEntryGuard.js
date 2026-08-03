"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBlockNewEntryOnRevision = shouldBlockNewEntryOnRevision;
/**
 * Message-revision / same-signal refresh must not open a second market or
 * broker-pending basket after the first entry already materialized.
 */
function shouldBlockNewEntryOnRevision(args) {
    if (args.blockNewEntry === true)
        return true;
    return args.sameSignalRefresh === true && args.alreadyMaterialized === true;
}
