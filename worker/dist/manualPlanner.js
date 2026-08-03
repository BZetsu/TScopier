"use strict";
/**
 * Manual-mode order planner (barrel).
 *
 * Implementation lives under `./manualPlanning/`; this file re-exports the
 * stable public surface so callers (e.g. `tradeExecutor`) keep importing `./manualPlanner`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.planManualOrders = exports.strictSignalEntryQuoteAllowsImmediate = exports.computeCwOverrideTp = exports.changeLayeringPlanMode = exports.serializeLayeringPlanSnapshot = exports.parseLayeringPlanSnapshot = exports.assertLayeringModeExecutionSupported = exports.normalizeLayeringModeSettings = exports.layeringModesExecutionEnabled = exports.isDynamicLayeringMode = exports.isStaticLayeringMode = exports.isLegacyLayeringMode = exports.resolveLayeringMode = exports.MAX_LAYER_COUNT = exports.MIN_LAYER_COUNT = exports.DEFAULT_DYNAMIC_MAX_LAYERS = exports.DEFAULT_DYNAMIC_STEP_PIPS = exports.DEFAULT_STATIC_LAYER_COUNT = exports.DEFAULT_LAYERING_MODE = exports.planRangeSplit = exports.planSinglePartialTps = exports.reverseSignalGateSatisfied = exports.signalRangeEntryQuoteAllowsImmediate = exports.buildRangeEntryWait = exports.SKIP_REASON_ENTRY_NOT_OPENED = exports.SKIP_REASON_SIGNAL_ENTRY_RANGE_EXPIRED = exports.SKIP_REASON_SIGNAL_ENTRY_RANGE_REQUIRED = exports.SKIP_REASON_SIGNAL_ENTRY_REQUIRED = exports.lastPositiveParsedTpPrice = exports.parsedHasExplicitEntryAnchor = exports.resolvedParsedEntryZone = exports.resolvedParsedEntryPrice = exports.clampPendingExpiryHours = exports.signalEntryRangeStrictEnabled = exports.signalEntryPriceStrictEnabled = void 0;
var manualSettings_1 = require("./manualPlanning/manualSettings");
Object.defineProperty(exports, "signalEntryPriceStrictEnabled", { enumerable: true, get: function () { return manualSettings_1.signalEntryPriceStrictEnabled; } });
Object.defineProperty(exports, "signalEntryRangeStrictEnabled", { enumerable: true, get: function () { return manualSettings_1.signalEntryRangeStrictEnabled; } });
Object.defineProperty(exports, "clampPendingExpiryHours", { enumerable: true, get: function () { return manualSettings_1.clampPendingExpiryHours; } });
var parsedEntry_1 = require("./manualPlanning/parsedEntry");
Object.defineProperty(exports, "resolvedParsedEntryPrice", { enumerable: true, get: function () { return parsedEntry_1.resolvedParsedEntryPrice; } });
Object.defineProperty(exports, "resolvedParsedEntryZone", { enumerable: true, get: function () { return parsedEntry_1.resolvedParsedEntryZone; } });
Object.defineProperty(exports, "parsedHasExplicitEntryAnchor", { enumerable: true, get: function () { return parsedEntry_1.parsedHasExplicitEntryAnchor; } });
Object.defineProperty(exports, "lastPositiveParsedTpPrice", { enumerable: true, get: function () { return parsedEntry_1.lastPositiveParsedTpPrice; } });
Object.defineProperty(exports, "SKIP_REASON_SIGNAL_ENTRY_REQUIRED", { enumerable: true, get: function () { return parsedEntry_1.SKIP_REASON_SIGNAL_ENTRY_REQUIRED; } });
Object.defineProperty(exports, "SKIP_REASON_SIGNAL_ENTRY_RANGE_REQUIRED", { enumerable: true, get: function () { return parsedEntry_1.SKIP_REASON_SIGNAL_ENTRY_RANGE_REQUIRED; } });
Object.defineProperty(exports, "SKIP_REASON_SIGNAL_ENTRY_RANGE_EXPIRED", { enumerable: true, get: function () { return parsedEntry_1.SKIP_REASON_SIGNAL_ENTRY_RANGE_EXPIRED; } });
Object.defineProperty(exports, "SKIP_REASON_ENTRY_NOT_OPENED", { enumerable: true, get: function () { return parsedEntry_1.SKIP_REASON_ENTRY_NOT_OPENED; } });
var signalEntryRange_1 = require("./manualPlanning/signalEntryRange");
Object.defineProperty(exports, "buildRangeEntryWait", { enumerable: true, get: function () { return signalEntryRange_1.buildRangeEntryWait; } });
Object.defineProperty(exports, "signalRangeEntryQuoteAllowsImmediate", { enumerable: true, get: function () { return signalEntryRange_1.signalRangeEntryQuoteAllowsImmediate; } });
var manualStops_1 = require("./manualPlanning/manualStops");
Object.defineProperty(exports, "reverseSignalGateSatisfied", { enumerable: true, get: function () { return manualStops_1.reverseSignalGateSatisfied; } });
var partialTpSchedule_1 = require("./manualPlanning/partialTpSchedule");
Object.defineProperty(exports, "planSinglePartialTps", { enumerable: true, get: function () { return partialTpSchedule_1.planSinglePartialTps; } });
var rangeSplit_1 = require("./manualPlanning/rangeSplit");
Object.defineProperty(exports, "planRangeSplit", { enumerable: true, get: function () { return rangeSplit_1.planRangeSplit; } });
var layeringModes_1 = require("./manualPlanning/layeringModes");
Object.defineProperty(exports, "DEFAULT_LAYERING_MODE", { enumerable: true, get: function () { return layeringModes_1.DEFAULT_LAYERING_MODE; } });
Object.defineProperty(exports, "DEFAULT_STATIC_LAYER_COUNT", { enumerable: true, get: function () { return layeringModes_1.DEFAULT_STATIC_LAYER_COUNT; } });
Object.defineProperty(exports, "DEFAULT_DYNAMIC_STEP_PIPS", { enumerable: true, get: function () { return layeringModes_1.DEFAULT_DYNAMIC_STEP_PIPS; } });
Object.defineProperty(exports, "DEFAULT_DYNAMIC_MAX_LAYERS", { enumerable: true, get: function () { return layeringModes_1.DEFAULT_DYNAMIC_MAX_LAYERS; } });
Object.defineProperty(exports, "MIN_LAYER_COUNT", { enumerable: true, get: function () { return layeringModes_1.MIN_LAYER_COUNT; } });
Object.defineProperty(exports, "MAX_LAYER_COUNT", { enumerable: true, get: function () { return layeringModes_1.MAX_LAYER_COUNT; } });
Object.defineProperty(exports, "resolveLayeringMode", { enumerable: true, get: function () { return layeringModes_1.resolveLayeringMode; } });
Object.defineProperty(exports, "isLegacyLayeringMode", { enumerable: true, get: function () { return layeringModes_1.isLegacyLayeringMode; } });
Object.defineProperty(exports, "isStaticLayeringMode", { enumerable: true, get: function () { return layeringModes_1.isStaticLayeringMode; } });
Object.defineProperty(exports, "isDynamicLayeringMode", { enumerable: true, get: function () { return layeringModes_1.isDynamicLayeringMode; } });
Object.defineProperty(exports, "layeringModesExecutionEnabled", { enumerable: true, get: function () { return layeringModes_1.layeringModesExecutionEnabled; } });
Object.defineProperty(exports, "normalizeLayeringModeSettings", { enumerable: true, get: function () { return layeringModes_1.normalizeLayeringModeSettings; } });
Object.defineProperty(exports, "assertLayeringModeExecutionSupported", { enumerable: true, get: function () { return layeringModes_1.assertLayeringModeExecutionSupported; } });
Object.defineProperty(exports, "parseLayeringPlanSnapshot", { enumerable: true, get: function () { return layeringModes_1.parseLayeringPlanSnapshot; } });
Object.defineProperty(exports, "serializeLayeringPlanSnapshot", { enumerable: true, get: function () { return layeringModes_1.serializeLayeringPlanSnapshot; } });
Object.defineProperty(exports, "changeLayeringPlanMode", { enumerable: true, get: function () { return layeringModes_1.changeLayeringPlanMode; } });
var cwOverride_1 = require("./manualPlanning/cwOverride");
Object.defineProperty(exports, "computeCwOverrideTp", { enumerable: true, get: function () { return cwOverride_1.computeCwOverrideTp; } });
var executionShape_1 = require("./manualPlanning/executionShape");
Object.defineProperty(exports, "strictSignalEntryQuoteAllowsImmediate", { enumerable: true, get: function () { return executionShape_1.strictSignalEntryQuoteAllowsImmediate; } });
var planManualOrders_1 = require("./manualPlanning/planManualOrders");
Object.defineProperty(exports, "planManualOrders", { enumerable: true, get: function () { return planManualOrders_1.planManualOrders; } });
