"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planManualOrders = planManualOrders;
/** MT pip size convention: 5/3-digit FX quotes treat one pip as 10 points; the rest treat one pip == point. */
function pipSize(point, digits) {
    if (!Number.isFinite(point) || point <= 0)
        return 0.0001;
    if (digits === 3 || digits === 5)
        return point * 10;
    return point;
}
function withinTimeWindow(start, end, now) {
    // Times are HH:MM strings in the user's local browser TZ. We approximate by
    // comparing against the server's local time here; for global accuracy we'd
    // need to store the user's TZ alongside the settings (TODO).
    const toMinutes = (s) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
        if (!m)
            return null;
        const h = Number(m[1]);
        const mm = Number(m[2]);
        if (!Number.isFinite(h) || !Number.isFinite(mm))
            return null;
        return h * 60 + mm;
    };
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s == null || e == null)
        return true;
    const cur = now.getHours() * 60 + now.getMinutes();
    // Window can wrap midnight (e.g. 22:00 → 06:00).
    if (s <= e)
        return cur >= s && cur <= e;
    return cur >= s || cur <= e;
}
/** Build the order plan. Returns an empty plan with skip_reason when filtered out. */
function planManualOrders(args) {
    const { parsed, resolvedSymbol, baseOperation, manual, channelKeywords, manualLot, ctx, commentPrefix, expertId, slippage, } = args;
    const now = ctx.now ?? new Date();
    const delay_ms = Math.max(0, Number(channelKeywords?.additional?.delay_msec ?? 0) | 0);
    // ── 1. Filters ──────────────────────────────────────────────────────────
    if (manual.days_filter_enabled) {
        const allowed = (manual.trade_days ?? [0, 1, 2, 3, 4, 5, 6]).map(Number);
        if (!allowed.includes(now.getDay())) {
            return { orders: [], skip_reason: 'filtered_day', delay_ms };
        }
    }
    if (manual.time_filter_enabled && manual.trade_start_time && manual.trade_end_time) {
        if (!withinTimeWindow(manual.trade_start_time, manual.trade_end_time, now)) {
            return { orders: [], skip_reason: 'filtered_time', delay_ms };
        }
    }
    // ── 2. Reverse direction ────────────────────────────────────────────────
    const operation = manual.reverse_signal ? flipOperation(baseOperation) : baseOperation;
    const isBuy = operation.startsWith('Buy');
    // ── 3. Resolve entry price (with channel prefer_entry on zones) ─────────
    let entry = parsed.entry_price ?? null;
    if (entry == null && parsed.entry_zone_low != null && parsed.entry_zone_high != null) {
        const lo = Number(parsed.entry_zone_low);
        const hi = Number(parsed.entry_zone_high);
        const prefer = channelKeywords?.additional?.prefer_entry ?? 'first_price';
        entry = prefer === 'last_price' ? Math.max(lo, hi) : Math.min(lo, hi);
    }
    // ── 4. SL/TP derivation ─────────────────────────────────────────────────
    const pip = pipSize(ctx.point, ctx.digits);
    const slInPips = channelKeywords?.additional?.sl_in_pips === true;
    const tpInPips = channelKeywords?.additional?.tp_in_pips === true;
    // Channel reported pip distances rather than prices — convert.
    let parsedSl = parsed.sl ?? null;
    let parsedTps = (parsed.tp ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (slInPips && parsedSl != null && entry != null) {
        parsedSl = isBuy ? entry - parsedSl * pip : entry + parsedSl * pip;
    }
    if (tpInPips && parsedTps.length && entry != null) {
        parsedTps = parsedTps.map(t => (isBuy ? entry + t * pip : entry - t * pip));
    }
    // Apply manual_settings overrides for SL/TP when enabled.
    let finalSl = parsedSl;
    let finalTps = parsedTps;
    if (manual.use_predefined_sl_pips && Number.isFinite(manual.predefined_sl_pips ?? NaN) && entry != null) {
        const sl_pips = Number(manual.predefined_sl_pips);
        finalSl = isBuy ? entry - sl_pips * pip : entry + sl_pips * pip;
    }
    if (manual.use_predefined_tp_pips && Array.isArray(manual.predefined_tp_pips) && entry != null) {
        const tps = manual.predefined_tp_pips
            .map(Number)
            .filter(n => Number.isFinite(n) && n > 0);
        if (tps.length) {
            finalTps = tps.map(t => (isBuy ? entry + t * pip : entry - t * pip));
        }
    }
    // R:R derivation when only one side is known.
    if (manual.rr_for_sl_enabled && Number.isFinite(manual.rr_for_sl ?? NaN) && entry != null && finalTps.length && finalSl == null) {
        const rr = Number(manual.rr_for_sl);
        if (rr > 0) {
            const tpDist = Math.abs(finalTps[0] - entry);
            const slDist = tpDist / rr;
            finalSl = isBuy ? entry - slDist : entry + slDist;
        }
    }
    if (manual.rr_for_tps_enabled && Array.isArray(manual.rr_for_tps) && entry != null && finalSl != null && finalTps.length === 0) {
        const slDist = Math.abs(entry - finalSl);
        finalTps = manual.rr_for_tps
            .map(Number)
            .filter(n => Number.isFinite(n) && n > 0)
            .map(rr => (isBuy ? entry + rr * slDist : entry - rr * slDist));
    }
    const roundPrice = (v) => {
        if (v == null || !Number.isFinite(v))
            return 0;
        const d = Math.max(0, Math.min(8, Number.isFinite(ctx.digits) ? ctx.digits : 5));
        return Number(v.toFixed(d));
    };
    // ── 5. Multi-TP fan-out ─────────────────────────────────────────────────
    const tradeStyle = manual.trade_style === 'multi' ? 'multi' : 'single';
    const enabledTpLots = (manual.tp_lots ?? []).filter(t => t && t.enabled && Number.isFinite(t.lot) && t.lot > 0);
    const orderBase = {
        symbol: resolvedSymbol,
        operation,
        price: roundPrice(entry),
        slippage: slippage ?? 20,
        comment: commentPrefix,
        expertID: expertId,
    };
    const expirationFields = {};
    if (operation.includes('Limit') || operation.includes('Stop')) {
        const hours = Number(manual.pending_expiry_hours ?? 0);
        if (Number.isFinite(hours) && hours > 0) {
            const exp = new Date(now.getTime() + hours * 60 * 60 * 1000);
            expirationFields.expiration = exp.toISOString();
            expirationFields.expirationType = 'Specified';
        }
    }
    const orders = [];
    if (tradeStyle === 'multi' && enabledTpLots.length && finalTps.length) {
        // Pair each enabled tp_lots entry with a TP price by index, falling back to the last TP if we run out.
        for (let i = 0; i < enabledTpLots.length; i++) {
            const tpLot = enabledTpLots[i];
            const tpPrice = finalTps[i] ?? finalTps[finalTps.length - 1];
            orders.push({
                ...orderBase,
                volume: tpLot.lot,
                stoploss: roundPrice(finalSl),
                takeprofit: roundPrice(tpPrice),
                ...expirationFields,
                comment: `${commentPrefix}:tp${i + 1}`,
            });
        }
    }
    else {
        const tpPrice = finalTps[0] ?? null;
        orders.push({
            ...orderBase,
            volume: manualLot,
            stoploss: roundPrice(finalSl),
            takeprofit: roundPrice(tpPrice),
            ...expirationFields,
        });
    }
    return { orders, delay_ms };
}
function flipOperation(op) {
    switch (op) {
        case 'Buy': return 'Sell';
        case 'Sell': return 'Buy';
        case 'BuyLimit': return 'SellLimit';
        case 'SellLimit': return 'BuyLimit';
        case 'BuyStop': return 'SellStop';
        case 'SellStop': return 'BuyStop';
        case 'BuyStopLimit': return 'SellStopLimit';
        case 'SellStopLimit': return 'BuyStopLimit';
        default: return op;
    }
}
