"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FxClient = exports.FxHttpError = void 0;
exports.perTerminalConcurrency = perTerminalConcurrency;
exports.getFxClient = getFxClient;
exports.toMtPlatform = toMtPlatform;
/**
 * FxClient (Phase 1) - the strict, idempotent FxSocket MT5 client.
 *
 * Design goals (from the rebuild plan):
 *  - Reliability: every order op accepted ONLY when success && retcode in DONE set
 *    (see classifyOrderResponse). A 200 is never assumed to mean "accepted".
 *  - Idempotency: OrderSend is NEVER blind-retried. On an ambiguous failure
 *    (timeout / network / 5xx) the send is resolved by reading OpenedOrders and
 *    adopting any matching new position, so duplicate legs are impossible.
 *  - Speed: bounded per-call timeout (default 12s, not 90s); per-terminal
 *    concurrency gate so one slow terminal cannot be flooded.
 *
 * Transport is injectable for tests (no network needed).
 */
const undici_1 = require("undici");
const perAccountConcurrency_1 = require("../perAccountConcurrency");
const fxContract_1 = require("./fxContract");
class FxHttpError extends Error {
    constructor(message, status, body, ambiguous) {
        super(message);
        this.name = 'FxHttpError';
        this.status = status;
        this.body = body;
        this.ambiguous = ambiguous;
    }
}
exports.FxHttpError = FxHttpError;
const DEFAULT_BASE_URL = 'https://api.fxsocket.com';
function envInt(name, def, min, max) {
    const raw = Number(process.env[name] ?? def);
    return Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.floor(raw))) : def;
}
const KEEP_ALIVE_AGENT = new undici_1.Agent({
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 600000,
    connections: envInt('FXSOCKET_HTTP_CONNECTIONS', 64, 8, 512),
    pipelining: 1,
});
/** Default undici transport. */
async function undiciTransport(req) {
    const res = await (0, undici_1.request)(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        dispatcher: KEEP_ALIVE_AGENT,
        headersTimeout: req.timeoutMs,
        bodyTimeout: req.timeoutMs,
    });
    const text = await res.body.text();
    let parsed = null;
    if (text) {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = text;
        }
    }
    return { status: res.statusCode, body: parsed };
}
/**
 * A transport-level failure is AMBIGUOUS for a send when the request may have
 * reached the terminal (timeout, reset, abort, gateway timeout). A connection
 * that never opened (ECONNREFUSED/DNS) or a 5xx gateway-not-reached is safe.
 */
function transportErrorIsAmbiguous(err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (/econnrefused|enotfound|getaddrinfo|ehostunreach|dns/.test(msg))
        return false;
    return /timeout|timed\s*out|econnreset|socket hang up|aborted|fetch failed|network/.test(msg);
}
const tradeGate = (0, perAccountConcurrency_1.createConcurrencyGate)();
function perTerminalConcurrency() {
    return envInt('MT_PER_ACCOUNT_TRADE_CONCURRENCY', 4, 1, 16);
}
let sharedClient = null;
/** Process-wide FxClient (one per-terminal gate, one transport). */
function getFxClient() {
    if (!sharedClient)
        sharedClient = new FxClient();
    return sharedClient;
}
/** Map a broker_accounts.platform value to the bridge segment. */
function toMtPlatform(platform) {
    return String(platform ?? '').toUpperCase() === 'MT4' ? 'MT4' : 'MT5';
}
class FxClient {
    constructor(opts = {}) {
        this.apiKey = opts.apiKey ?? process.env.FXSOCKET_API_KEY ?? '';
        this.baseUrl = (opts.baseUrl ?? process.env.FXSOCKET_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.timeoutMs = opts.timeoutMs ?? envInt('FXSOCKET_CALL_TIMEOUT_MS', 12000, 2000, 90000);
        this.transport = opts.transport ?? undiciTransport;
    }
    path(accountId, platform, endpoint) {
        const seg = platform === 'MT4' ? 'mt4' : 'mt5';
        return `${this.baseUrl}/${seg}/${encodeURIComponent(accountId)}/${endpoint}`;
    }
    async http(method, url, body, timeoutMs) {
        const headers = {
            'X-API-Key': this.apiKey,
            accept: 'application/json, text/plain',
        };
        let serialized;
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            serialized = JSON.stringify(body);
        }
        let res;
        try {
            res = await this.transport({ method, url, headers, body: serialized, timeoutMs: timeoutMs ?? this.timeoutMs });
        }
        catch (err) {
            throw new FxHttpError(err instanceof Error ? err.message : String(err), 0, null, transportErrorIsAmbiguous(err));
        }
        if (res.status < 200 || res.status >= 300) {
            // 5xx may mean the terminal never processed it; 504 (gateway timeout) is ambiguous.
            const ambiguous = res.status === 504 || res.status === 408;
            throw new FxHttpError(`HTTP ${res.status}`, res.status, res.body, ambiguous);
        }
        return res.body;
    }
    // ── Reads ─────────────────────────────────────────────────────────────────
    async openedOrders(accountId, platform) {
        const raw = await this.http('GET', this.path(accountId, platform, 'OpenedOrders'), undefined);
        const list = unwrapList(raw);
        return list.map(fxContract_1.normalizeOpenOrder).filter((o) => o != null);
    }
    async quote(accountId, platform, symbol) {
        const raw = await this.http('GET', `${this.path(accountId, platform, 'getQuote')}?symbol=${encodeURIComponent(symbol)}`, undefined);
        const root = (raw && typeof raw === 'object' ? raw : {});
        const r = (root.result && typeof root.result === 'object' ? root.result : root);
        const bid = Number(r.bid ?? r.Bid);
        const ask = Number(r.ask ?? r.Ask);
        if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
            throw new FxHttpError(`getQuote: invalid bid/ask for ${symbol}`, 200, raw, false);
        }
        return { bid, ask };
    }
    // ── Orders ────────────────────────────────────────────────────────────────
    /**
     * Idempotent OrderSend. Never blind-retries. On an ambiguous failure it reads
     * OpenedOrders and adopts a matching new position (by comment, else by
     * symbol+volume+recency vs preSnapshot). Returns ok=false only when the order
     * is confirmed NOT placed (safe for the caller to retry).
     */
    async orderSend(accountId, platform, req, opts) {
        const comment = req.comment ?? (0, fxContract_1.buildOrderComment)(opts.anchorSignalId, opts.legIndex);
        const payload = {
            symbol: req.symbol,
            operation: req.operation,
            volume: req.volume,
            slippage: req.slippage ?? 20,
            comment,
            expertId: req.expertId ?? fxContract_1.TSCOPIER_MAGIC,
        };
        if (req.price != null && req.price > 0)
            payload.price = req.price;
        if (req.stopLimitPrice != null && req.stopLimitPrice > 0)
            payload.stopLimitPrice = req.stopLimitPrice;
        if (req.stopLoss != null && req.stopLoss > 0)
            payload.stopLoss = req.stopLoss;
        if (req.takeProfit != null && req.takeProfit > 0)
            payload.takeProfit = req.takeProfit;
        if (req.expiration)
            payload.expiration = req.expiration;
        const release = await tradeGate.acquire(accountId, perTerminalConcurrency());
        try {
            let raw;
            try {
                raw = await this.http('POST', this.path(accountId, platform, 'OrderSend'), payload);
            }
            catch (err) {
                if (err instanceof FxHttpError && err.ambiguous) {
                    // The order may have opened. Resolve via OpenedOrders - never re-send.
                    return await this.resolveAmbiguousSend(accountId, platform, req, comment, opts, err);
                }
                // Definitely not placed (connection refused / 4xx / non-ambiguous 5xx).
                return failResult(err, /*notPlaced*/ true);
            }
            const result = (0, fxContract_1.classifyOrderResponse)(raw);
            if (result.ok)
                return result;
            // Application-level reject. If retcode says definitely-not-placed, return as-is.
            if (result.retcode != null && fxContract_1.ORDER_NOT_PLACED_RETCODES.has(result.retcode))
                return result;
            // Unknown/ambiguous app reject -> verify against broker before trusting it.
            const adopted = await this.findMatchingNewOrder(accountId, platform, req, comment, opts).catch(() => null);
            return adopted ?? result;
        }
        finally {
            release();
        }
    }
    async resolveAmbiguousSend(accountId, platform, req, comment, opts, cause) {
        const adopted = await this.findMatchingNewOrder(accountId, platform, req, comment, opts).catch(() => null);
        if (adopted)
            return adopted;
        // Could not confirm it opened. Report ambiguous failure - caller must NOT blind retry.
        return {
            ok: false, partial: false, retcode: null, retcodeName: 'AMBIGUOUS',
            message: `ambiguous send (${cause.message}); no matching order found`,
            ticket: null, order: null, deal: null, volume: null, price: null, bid: null, ask: null,
            comment, raw: cause.body,
        };
    }
    /** Look for a position that this send likely created (comment match, else symbol+volume+new). */
    async findMatchingNewOrder(accountId, platform, req, comment, opts) {
        const after = await this.openedOrders(accountId, platform);
        const before = new Set((opts.preSnapshot ?? []).map(o => o.ticket));
        const isBuy = /buy/i.test(req.operation);
        const sym = normSym(req.symbol);
        const candidates = after.filter(o => !before.has(o.ticket)
            && normSym(o.symbol) === sym
            && o.isBuy === isBuy);
        // Prefer exact comment match, then volume match, then most recent (highest ticket).
        const byComment = candidates.find(o => o.comment && o.comment === comment);
        const byVolume = candidates.find(o => Math.abs(o.volume - req.volume) < 1e-6);
        const pick = byComment ?? byVolume ?? candidates.sort((a, b) => b.ticket - a.ticket)[0];
        if (!pick)
            return null;
        return {
            ok: true, partial: false, retcode: 10009, retcodeName: 'DONE',
            message: 'adopted existing order after ambiguous send',
            ticket: pick.ticket, order: pick.ticket, deal: null,
            volume: pick.volume, price: pick.openPrice, bid: null, ask: null,
            comment: pick.comment, raw: pick,
        };
    }
    /** OrderModify is idempotent - safe to retry on ambiguous failure (bounded). */
    async orderModify(accountId, platform, req) {
        const payload = { ticket: req.ticket };
        if (req.stopLoss != null)
            payload.stopLoss = req.stopLoss;
        if (req.takeProfit != null)
            payload.takeProfit = req.takeProfit;
        if (req.price != null)
            payload.price = req.price;
        if (req.stopLimitPrice != null)
            payload.stopLimitPrice = req.stopLimitPrice;
        if (req.expiration)
            payload.expiration = req.expiration;
        const attempts = envInt('MT_ORDERMODIFY_MAX_ATTEMPTS', 2, 1, 4);
        const release = await tradeGate.acquire(accountId, perTerminalConcurrency());
        try {
            let last = null;
            for (let i = 0; i < attempts; i++) {
                try {
                    const raw = await this.http('POST', this.path(accountId, platform, 'OrderModify'), payload);
                    const result = (0, fxContract_1.classifyOrderResponse)(raw);
                    // "No changes" means the broker is already at the desired SL/TP - a no-op success.
                    if (result.retcode != null && fxContract_1.BENIGN_MODIFY_RETCODES.has(result.retcode)) {
                        return { ...result, ok: true, message: 'already at target (no changes)' };
                    }
                    if (result.ok || (result.retcode != null && fxContract_1.ORDER_NOT_PLACED_RETCODES.has(result.retcode)))
                        return result;
                    last = result;
                }
                catch (err) {
                    last = failResult(err, false);
                    if (!(err instanceof FxHttpError) || !err.ambiguous)
                        return last;
                }
                if (i < attempts - 1)
                    await sleep(300 * (i + 1));
            }
            return last ?? failResult(new Error('orderModify exhausted'), false);
        }
        finally {
            release();
        }
    }
    async orderClose(accountId, platform, req) {
        const payload = { ticket: req.ticket, slippage: req.slippage ?? 20 };
        if (req.volume != null && req.volume > 0)
            payload.volume = req.volume;
        if (req.price != null && req.price > 0)
            payload.price = req.price;
        const release = await tradeGate.acquire(accountId, perTerminalConcurrency());
        try {
            const raw = await this.http('POST', this.path(accountId, platform, 'OrderClose'), payload);
            const result = (0, fxContract_1.classifyOrderResponse)(raw);
            // Already closed = idempotent success.
            if (!result.ok && result.retcode === fxContract_1.MT5_RETCODE.POSITION_CLOSED) {
                return { ...result, ok: true, message: 'already closed' };
            }
            return result;
        }
        catch (err) {
            if (err instanceof FxHttpError && err.ambiguous) {
                // Verify: if the ticket is gone from OpenedOrders, the close succeeded.
                const still = await this.openedOrders(accountId, platform).catch(() => null);
                if (still && !still.some(o => o.ticket === req.ticket)) {
                    return { ok: true, partial: false, retcode: 10009, retcodeName: 'DONE', message: 'close confirmed via snapshot', ticket: req.ticket, order: req.ticket, deal: null, volume: null, price: null, bid: null, ask: null, comment: null, raw: null };
                }
            }
            return failResult(err, false);
        }
        finally {
            release();
        }
    }
}
exports.FxClient = FxClient;
function failResult(err, notPlaced) {
    const message = err instanceof Error ? err.message : String(err);
    return {
        ok: false, partial: false, retcode: null,
        retcodeName: notPlaced ? 'NOT_PLACED' : 'ERROR',
        message, ticket: null, order: null, deal: null, volume: null, price: null, bid: null, ask: null, comment: null,
        raw: err instanceof FxHttpError ? err.body : null,
    };
}
function unwrapList(raw) {
    if (Array.isArray(raw))
        return raw;
    if (raw && typeof raw === 'object') {
        const o = raw;
        for (const k of ['result', 'orders', 'data', 'positions', 'items']) {
            if (Array.isArray(o[k]))
                return o[k];
        }
    }
    return [];
}
function normSym(s) {
    return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
