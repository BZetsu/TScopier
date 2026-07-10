from app.signal_heuristic import looks_like_trading_signal


def test_position_commentary_not_trading_signal() -> None:
    msg = (
        "This trade we right now in, selling gold, has a high potential of a very big drop."
    )
    assert not looks_like_trading_signal(msg)
