"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetatraderApiClient = exports.MetatraderApiError = void 0;
exports.normalizeOrderResponse = normalizeOrderResponse;
exports.getMetatraderApi = getMetatraderApi;
const undici_1 = require("undici");
/**
 * MetatraderAPI (metatraderapi.dev) Node client tuned for low order-send latency.
 *
 * - Singleton undici Agent keeps a TLS-warm connection pool to api.metatraderapi.dev,
 *   so OrderSend round-trips skip TLS handshakes after the first call.
 * - All endpoints are GET with query parameters per
 *   https://docs.metatraderapi.dev/docs/metatrader-5-api.
 */
const DEFAULT_BASE_URL = 'https://api.metatraderapi.dev';
const KEEP_ALIVE_AGENT = new undici_1.Agent({
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 600000,
    connections: 32,
    pipelining: 1,
});
function num(v) {
    if (v === null || v === undefined)
        return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function nestedTicket(o, key) {
    const nest = o[key];
    if (nest == null || typeof nest !== 'object')
        return undefined;
    const n = nest;
    return n.ticket ?? n.Ticket ?? n.order ?? n.Order;
}
/**
 * MetatraderAPI JSON often follows protobuf names: PascalCase on the `Order`
 * object, and `OrderSendReply` wraps the order as `{ result: { ... }, error }`.
 * Normalize to our camelCase `OrderResult` so callers always see `ticket`.
 */
function normalizeOrderResponse(body) {
    if (body == null || typeof body !== 'object') {
        return { ticket: NaN };
    }
    const root = body;
    // OrderSendReply / OrderModifyReply / OrderCloseReply: { result: Order, error?: ... }
    let o = root;
    if ('result' in root && root.result != null && typeof root.result === 'object') {
        o = root.result;
    }
    const ticketRaw = o.ticket ??
        o.Ticket ??
        o.orderId ??
        o.OrderId ??
        nestedTicket(o, 'deal') ??
        nestedTicket(o, 'Deal') ??
        nestedTicket(o, 'DealInternalIn') ??
        nestedTicket(o, 'ex');
    const ticket = typeof ticketRaw === 'number' ? ticketRaw : Number(ticketRaw);
    return {
        ticket: Number.isFinite(ticket) ? ticket : NaN,
        openPrice: num(o.openPrice ?? o.OpenPrice),
        stopLoss: num(o.stopLoss ?? o.StopLoss),
        takeProfit: num(o.takeProfit ?? o.TakeProfit),
        lots: num(o.lots ?? o.Lots ?? o.volume ?? o.Volume),
        symbol: typeof o.symbol === 'string' ? o.symbol : typeof o.Symbol === 'string' ? o.Symbol : undefined,
        orderType: typeof o.orderType === 'string' ? o.orderType : typeof o.OrderType === 'string' ? String(o.OrderType) : undefined,
        state: typeof o.state === 'string' ? o.state : typeof o.State === 'string' ? String(o.State) : undefined,
        closePrice: num(o.closePrice ?? o.ClosePrice),
        profit: num(o.profit ?? o.Profit),
        swap: num(o.swap ?? o.Swap),
        commission: num(o.commission ?? o.Commission),
        fee: num(o.fee ?? o.Fee),
        comment: typeof o.comment === 'string' ? o.comment : typeof o.Comment === 'string' ? o.Comment : undefined,
    };
}
function assertNoApiError(body) {
    if (body == null || typeof body !== 'object')
        return;
    const root = body;
    // Shape A: { error: { message, code } }
    const err = root.error;
    if (err && typeof err === 'object') {
        const e = err;
        const m = String(e.message ?? e.Message ?? '').trim();
        if (m && m !== 'null' && m !== 'undefined') {
            throw new MetatraderApiError(m, 200, e.code != null ? String(e.code) : undefined);
        }
    }
    // Shape B: top-level { message, code, stackTrace } (no `error` wrapper, no `result`).
    // This is what mt5rest returns for things like "Symbol not found".
    if (!('result' in root) && !('ticket' in root) && !('Ticket' in root)) {
        const m = root.message ?? root.Message;
        const code = root.code ?? root.Code;
        if (typeof m === 'string' && m.trim()) {
            // Treat code 'OK' / 'DONE' with a message as still-an-error when there's no order payload.
            throw new MetatraderApiError(m.trim(), 200, code != null ? String(code) : undefined);
        }
    }
}
class MetatraderApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.name = 'MetatraderApiError';
        this.status = status;
        this.code = code;
    }
}
exports.MetatraderApiError = MetatraderApiError;
function buildQuery(params) {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '')
            continue;
        out.set(k, String(v));
    }
    return out.toString();
}
class MetatraderApiClient {
    constructor(apiKey, baseUrl = DEFAULT_BASE_URL, timeoutMs = 30000) {
        if (!apiKey)
            throw new Error('MetatraderApiClient: apiKey is required');
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
    }
    async get(path, params) {
        const qs = buildQuery(params);
        const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
        const res = await (0, undici_1.request)(url, {
            method: 'GET',
            headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
            dispatcher: KEEP_ALIVE_AGENT,
            headersTimeout: this.timeoutMs,
            bodyTimeout: this.timeoutMs,
        });
        const text = await res.body.text();
        let body = null;
        if (text) {
            try {
                body = JSON.parse(text);
            }
            catch {
                body = text;
            }
        }
        const status = res.statusCode;
        if (status < 200 || status >= 300) {
            const obj = (body && typeof body === 'object') ? body : null;
            const msg = obj?.message ? String(obj.message)
                : obj?.error ? String(obj.error)
                    : text || `HTTP ${status}`;
            const code = obj?.code ? String(obj.code) : undefined;
            throw new MetatraderApiError(msg, status, code);
        }
        return body;
    }
    openedOrders(id) {
        return this.get('/OpenedOrders', { id });
    }
    accountSummary(id) {
        return this.get('/AccountSummary', { id });
    }
    checkConnect(id) {
        return this.get('/CheckConnect', { id });
    }
    symbolParams(id, symbol) {
        return this.get('/SymbolParams', { id, symbol });
    }
    /** Returns the broker's full instrument list. Some servers return string[], others SymbolInfo[]. */
    symbols(id) {
        return this.get('/Symbols', { id });
    }
    async orderSend(id, args) {
        const raw = await this.get('/OrderSend', {
            id,
            symbol: args.symbol,
            operation: args.operation,
            volume: args.volume,
            price: args.price ?? 0,
            slippage: args.slippage ?? 20,
            stoploss: args.stoploss ?? 0,
            takeprofit: args.takeprofit ?? 0,
            comment: args.comment,
            expertID: args.expertID ?? 0,
            expiration: args.expiration,
            expirationType: args.expirationType,
        });
        assertNoApiError(raw);
        const out = normalizeOrderResponse(raw);
        if (!Number.isFinite(out.ticket) || out.ticket <= 0) {
            const preview = typeof raw === 'object' && raw !== null ? JSON.stringify(raw).slice(0, 500) : String(raw);
            throw new MetatraderApiError(`OrderSend returned no ticket (response: ${preview})`, 200);
        }
        return out;
    }
    async orderModify(id, args) {
        const raw = await this.get('/OrderModify', {
            id,
            ticket: args.ticket,
            stoploss: args.stoploss ?? 0,
            takeprofit: args.takeprofit ?? 0,
            price: args.price ?? 0,
            expiration: args.expiration,
            expirationType: args.expirationType,
        });
        assertNoApiError(raw);
        return normalizeOrderResponse(raw);
    }
    async orderClose(id, args) {
        const raw = await this.get('/OrderClose', {
            id,
            ticket: args.ticket,
            lots: args.lots ?? 0,
            price: args.price ?? 0,
            slippage: args.slippage ?? 20,
        });
        assertNoApiError(raw);
        return normalizeOrderResponse(raw);
    }
}
exports.MetatraderApiClient = MetatraderApiClient;
let cachedClient = null;
function getMetatraderApi() {
    if (cachedClient)
        return cachedClient;
    const apiKey = process.env.METATRADERAPI_KEY?.trim() ?? '';
    if (!apiKey)
        return null;
    const baseUrl = process.env.METATRADERAPI_BASE_URL?.trim() || DEFAULT_BASE_URL;
    cachedClient = new MetatraderApiClient(apiKey, baseUrl);
    return cachedClient;
}
