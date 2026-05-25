"""Lightweight trading-signal heuristic (matches TS looksLikeTradingSignal intent)."""

from __future__ import annotations

import re

_BUY_SELL = re.compile(r"\b(buy|sell|long|short)\b", re.I)
_SYMBOL = re.compile(
    r"\b([A-Z]{3,6}(?:USD|EUR|GBP|JPY|XAU|XAG|BTC|ETH)|XAUUSD|XAGUSD|GOLD|SILVER)\b",
    re.I,
)
_PRICE = re.compile(r"\b\d+(\.\d+)?\b")
_SL_TP = re.compile(r"\b(SL|TP|stop\s*loss|take\s*profit|entry)\b", re.I)


def looks_like_trading_signal(text: str, is_reply: bool = False) -> bool:
    t = (text or "").strip()
    if len(t) < 3:
        return False
    if is_reply and (_BUY_SELL.search(t) or _SL_TP.search(t)):
        return True
    if _BUY_SELL.search(t) and (_SYMBOL.search(t) or _PRICE.search(t)):
        return True
    if _SL_TP.search(t) and _SYMBOL.search(t):
        return True
    if re.search(r"\b(close|exit|flatten|breakeven|be)\b", t, re.I) and (
        _SYMBOL.search(t) or is_reply
    ):
        return True
    return False
