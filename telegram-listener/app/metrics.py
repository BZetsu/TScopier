"""In-process metrics for /health."""

from __future__ import annotations

from collections import defaultdict

_counters: dict[str, int] = defaultdict(int)


def inc(name: str, delta: int = 1) -> None:
    _counters[name] += delta


def snapshot() -> dict[str, int]:
    return dict(_counters)
