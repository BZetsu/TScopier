"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GTMO_VIP_FIXTURES_DIR = void 0;
exports.loadChannelFixtures = loadChannelFixtures;
exports.evaluateChannelFixture = evaluateChannelFixture;
/**
 * Offline golden-scenario harness for channel parsing.
 *
 * Loads JSON fixtures (raw Telegram message + expected parse) and runs them
 * through `parseChannelMessageSync` with default keywords — no Supabase needed,
 * so it runs in CI and via `replayChannelParse --fixtures`.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const parseSignal_1 = require("./parseSignal");
exports.GTMO_VIP_FIXTURES_DIR = node_path_1.default.join(__dirname, '..', 'fixtures', 'channels', 'gtmo-vip');
function loadChannelFixtures(dir) {
    return node_fs_1.default
        .readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(file => ({
        file,
        fixture: JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, file), 'utf8')),
    }));
}
function evaluateChannelFixture(fixture) {
    const lexicon = null;
    const result = (0, parseSignal_1.parseChannelMessageSync)(fixture.message, parseSignal_1.DEFAULT_CHANNEL_KEYWORDS, lexicon);
    const expect = fixture.expect ?? {};
    const parsed = result.parsed;
    const failures = [];
    if (expect.status != null && result.status !== expect.status) {
        failures.push(`status: expected ${expect.status}, got ${result.status}`);
    }
    if (expect.action != null && parsed.action !== expect.action) {
        failures.push(`action: expected ${expect.action}, got ${parsed.action}`);
    }
    if (expect.symbol !== undefined && parsed.symbol !== expect.symbol) {
        failures.push(`symbol: expected ${String(expect.symbol)}, got ${String(parsed.symbol)}`);
    }
    if (expect.sl != null && parsed.sl !== expect.sl) {
        failures.push(`sl: expected ${expect.sl}, got ${String(parsed.sl)}`);
    }
    if (expect.entry_price != null && parsed.entry_price !== expect.entry_price) {
        failures.push(`entry_price: expected ${expect.entry_price}, got ${String(parsed.entry_price)}`);
    }
    if (expect.tp != null) {
        const tp = Array.isArray(parsed.tp) ? parsed.tp : [];
        if (JSON.stringify(tp) !== JSON.stringify(expect.tp)) {
            failures.push(`tp: expected ${JSON.stringify(expect.tp)}, got ${JSON.stringify(tp)}`);
        }
    }
    if (expect.tpCount != null) {
        const tp = Array.isArray(parsed.tp) ? parsed.tp : [];
        if (tp.length !== expect.tpCount) {
            failures.push(`tpCount: expected ${expect.tpCount}, got ${tp.length}`);
        }
    }
    return { ok: failures.length === 0, failures, result };
}
