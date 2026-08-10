"use strict";
/**
 * Detect when a Broker Pending limit has filled on the broker.
 *
 * MT5 / bridge APIs often replace the pending ticket with a new market ticket.
 * Relying only on ClosedOrders for the original ticket misses those fills.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFilledPositionTicket = resolveFilledPositionTicket;
exports.decideBrokerPendingOpenedState = decideBrokerPendingOpenedState;
exports.decideBrokerPendingClosedFill = decideBrokerPendingClosedFill;
const signalEntryPendingHelpers_1 = require("./signalEntryPendingHelpers");
const basketModFollowUp_1 = require("./basketModFollowUp");
function extractOpenPrice(raw) {
    const num = (v) => {
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v === 'string' && v.trim()) {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        }
        return undefined;
    };
    const px = num(raw.openPrice ?? raw.OpenPrice ?? raw.price ?? raw.Price ?? raw.priceOpen ?? raw.PriceOpen);
    return px != null && px > 0 ? px : null;
}
function readOpenedComment(row) {
    if (row == null || typeof row !== 'object')
        return '';
    const o = row;
    const c = o.comment ?? o.Comment;
    return typeof c === 'string' ? c : '';
}
function readOpenedVolume(row) {
    const num = (v) => {
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v === 'string' && v.trim()) {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        }
        return undefined;
    };
    const v = num(row.lots ?? row.Lots ?? row.volume ?? row.Volume ?? row.lotSize);
    return v != null && v > 0 ? v : null;
}
function priceNear(a, b, tolRatio = 0.002) {
    if (!(a > 0) || !(b > 0))
        return false;
    const tol = Math.max(b * tolRatio, b * 1e-6);
    return Math.abs(a - b) <= tol;
}
function volumeNear(a, b) {
    if (!(a > 0) || !(b > 0))
        return false;
    return Math.abs(a - b) <= Math.max(0.01, b * 0.05);
}
/**
 * Prefer a live market position ticket (MT5 often changes ticket on pending fill).
 * Comment match is authoritative; signal-only match requires volume + price proximity
 * so immediate market legs in the same basket are not mistaken for this fill.
 */
function resolveFilledPositionTicket(opened, leg, preferredTicket, excludeTickets) {
    if (preferredTicket != null && preferredTicket > 0) {
        const hit = (0, signalEntryPendingHelpers_1.findOpenedRowByTicket)(opened, preferredTicket);
        if (hit && (0, signalEntryPendingHelpers_1.isLikelyMarketPositionRow)(hit)) {
            return {
                ticket: String(preferredTicket),
                fillPrice: extractOpenPrice(hit),
                matchedBy: 'same_ticket',
            };
        }
    }
    const signalNeedle = leg.signal_id.slice(0, 8);
    const commentNeedle = (leg.comment ?? '').trim();
    let best = null;
    for (const raw of opened) {
        if (!raw || typeof raw !== 'object')
            continue;
        const o = raw;
        if (!(0, signalEntryPendingHelpers_1.isLikelyMarketPositionRow)(o))
            continue;
        const sym = String(o.symbol ?? o.Symbol ?? '');
        if (sym && !(0, basketModFollowUp_1.symbolsCompatibleForBasket)(leg.symbol, sym))
            continue;
        const ticket = (0, signalEntryPendingHelpers_1.rawOrderTicket)(o);
        if (!(ticket > 0))
            continue;
        const ticketStr = String(ticket);
        if (excludeTickets?.has(ticketStr))
            continue;
        const comment = readOpenedComment(raw);
        const matchesComment = commentNeedle.length > 0 && comment.includes(commentNeedle);
        const matchesSignal = comment.includes(signalNeedle) || comment.includes(leg.signal_id);
        if (!matchesComment && !matchesSignal)
            continue;
        const fillPrice = extractOpenPrice(o);
        const vol = readOpenedVolume(o);
        let score = 0;
        if (matchesComment)
            score += 100;
        else if (matchesSignal) {
            // Loose signal match only if this looks like the filled limit.
            if (fillPrice == null || !priceNear(fillPrice, leg.trigger_price))
                continue;
            if (vol == null || !volumeNear(vol, leg.volume))
                continue;
            score += 10;
        }
        if (fillPrice != null && priceNear(fillPrice, leg.trigger_price))
            score += 20;
        if (vol != null && volumeNear(vol, leg.volume))
            score += 10;
        if (!best || score > best.score) {
            best = { ticket: ticketStr, fillPrice, score };
        }
    }
    if (best && best.score >= 10) {
        return { ticket: best.ticket, fillPrice: best.fillPrice, matchedBy: 'comment' };
    }
    return { ticket: null, fillPrice: null, matchedBy: 'none' };
}
/** Classify a broker_pending row against a single /OpenedOrders snapshot. */
function decideBrokerPendingOpenedState(opened, leg, excludeTickets) {
    const ticket = Number(leg.ticket);
    if (!Number.isFinite(ticket) || ticket <= 0)
        return { kind: 'absent' };
    const hit = (0, signalEntryPendingHelpers_1.findOpenedRowByTicket)(opened, ticket);
    if (hit) {
        if ((0, signalEntryPendingHelpers_1.isPendingEntryRow)(hit))
            return { kind: 'still_pending' };
        if ((0, signalEntryPendingHelpers_1.isLikelyMarketPositionRow)(hit)) {
            const px = extractOpenPrice(hit) ?? leg.trigger_price;
            return {
                kind: 'filled',
                hit: {
                    fillPrice: px,
                    positionTicket: String(ticket),
                    matchedBy: 'same_ticket',
                },
            };
        }
        // Ambiguous same-ticket row — keep watching.
        return { kind: 'still_pending' };
    }
    const resolved = resolveFilledPositionTicket(opened, leg, ticket, excludeTickets);
    if (resolved.matchedBy !== 'none' && resolved.ticket) {
        return {
            kind: 'filled',
            hit: {
                fillPrice: resolved.fillPrice ?? leg.trigger_price,
                positionTicket: resolved.ticket,
                matchedBy: resolved.matchedBy === 'same_ticket' ? 'same_ticket' : 'comment',
            },
        };
    }
    return { kind: 'absent' };
}
/** When the pending ticket is gone, try ClosedOrders + OpenedOrders comment match. */
function decideBrokerPendingClosedFill(opened, closed, leg, excludeTickets) {
    const ticket = Number(leg.ticket);
    if (!Number.isFinite(ticket) || ticket <= 0)
        return null;
    const closedHit = (0, signalEntryPendingHelpers_1.findClosedRowForTicket)(closed, ticket);
    if (!closedHit) {
        // ClosedOrders may lag; still accept a strong OpenedOrders comment match.
        const openedOnly = decideBrokerPendingOpenedState(opened, leg, excludeTickets);
        if (openedOnly.kind === 'filled')
            return openedOnly.hit;
        return null;
    }
    const resolved = resolveFilledPositionTicket(opened, leg, ticket, excludeTickets);
    const fillPrice = resolved.fillPrice
        ?? (typeof closedHit.openPrice === 'number' && closedHit.openPrice > 0
            ? closedHit.openPrice
            : null)
        ?? leg.trigger_price;
    return {
        fillPrice,
        positionTicket: resolved.ticket
            ?? (closedHit.brokerTicket != null ? String(closedHit.brokerTicket) : String(ticket)),
        matchedBy: resolved.matchedBy === 'comment' ? 'comment' : 'closed_ticket',
    };
}
