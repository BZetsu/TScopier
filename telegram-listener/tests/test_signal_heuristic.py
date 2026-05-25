"""Tests for signal_heuristic — aligned with worker looksLikeTradingSignal."""

from app.signal_heuristic import looks_like_trading_signal


def test_standard_market_entry():
    assert looks_like_trading_signal("BUY XAUUSD NOW SL 2650 TP 2700")


def test_setup_without_buy_sell_but_entry_and_symbol():
    assert looks_like_trading_signal("Signal setup XAUUSD entry 2650 SL 2640")


def test_rejects_chat():
    assert not looks_like_trading_signal("Good morning traders, weekly outlook ahead.")


def test_reply_management():
    assert looks_like_trading_signal("Move SL to breakeven", is_reply=True)


def test_empty_text():
    assert not looks_like_trading_signal("")
