"""Worker configuration from environment."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.lower().strip() in ("1", "true", "yes")


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    telegram_api_id: int
    telegram_api_hash: str
    worker_internal_token: str
    worker_port: int
    worker_role: str
    shard_id: int
    shard_count: int
    instance_id: str
    trade_worker_url: str
    trade_mgmt_worker_url: str
    trade_signal_push_timeout_ms: int
    trade_signal_push_max_attempts: int
    lease_ttl_ms: int
    lease_renew_interval_ms: int
    health_stale_ms: int
    safety_poll_interval_ms: int
    catchup_max_age_minutes: int
    shutdown_drain_ms: int

    @staticmethod
    def load() -> "Config":
        return Config(
            supabase_url=os.getenv("SUPABASE_URL", "").strip(),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
            telegram_api_id=int(os.getenv("TELEGRAM_API_ID", "0")),
            telegram_api_hash=os.getenv("TELEGRAM_API_HASH", "").strip(),
            worker_internal_token=os.getenv("WORKER_INTERNAL_TOKEN", "").strip(),
            worker_port=int(os.getenv("WORKER_PORT", "8080")),
            worker_role=os.getenv("WORKER_ROLE", "listener").lower().strip(),
            shard_id=max(0, int(os.getenv("WORKER_SHARD_ID", "0"))),
            shard_count=max(1, int(os.getenv("WORKER_SHARD_COUNT", "1"))),
            instance_id=os.getenv(
                "WORKER_INSTANCE_ID",
                f"{os.getenv('HOSTNAME', 'local')}:{os.getpid()}",
            ),
            trade_worker_url=os.getenv("TRADE_WORKER_URL", "").strip().rstrip("/"),
            trade_mgmt_worker_url=os.getenv("TRADE_MGMT_WORKER_URL", "").strip().rstrip("/"),
            trade_signal_push_timeout_ms=max(
                500, min(10_000, int(os.getenv("TRADE_SIGNAL_PUSH_TIMEOUT_MS", "4000")))
            ),
            trade_signal_push_max_attempts=max(
                1, min(5, int(os.getenv("TRADE_SIGNAL_PUSH_MAX_ATTEMPTS", "3")))
            ),
            lease_ttl_ms=max(
                15_000, min(120_000, int(os.getenv("WORKER_SESSION_LEASE_TTL_MS", "45000")))
            ),
            lease_renew_interval_ms=max(
                5_000, min(60_000, int(os.getenv("WORKER_LEASE_RENEW_INTERVAL_MS", "20000")))
            ),
            health_stale_ms=max(
                60_000, min(600_000, int(os.getenv("WORKER_HEALTH_STALE_MS", "180000")))
            ),
            safety_poll_interval_ms=max(
                15_000, min(120_000, int(os.getenv("TELEGRAM_SAFETY_POLL_INTERVAL_MS", "30000")))
            ),
            catchup_max_age_minutes=max(
                1, min(24 * 60, int(os.getenv("TELEGRAM_CATCHUP_MAX_AGE_MINUTES", "20")))
            ),
            shutdown_drain_ms=max(
                0, min(60_000, int(os.getenv("TELEGRAM_SHUTDOWN_DRAIN_MS", "8000")))
            ),
        )


def shard_for_user_id(user_id: str, shard_count: int) -> int:
    h = 0
    for ch in user_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return abs(h) % max(1, shard_count)


def user_belongs_to_shard(user_id: str, cfg: Config) -> bool:
    return shard_for_user_id(user_id, cfg.shard_count) == cfg.shard_id


def listener_worker_id(cfg: Config) -> str:
    return f"{cfg.instance_id}:listener:{cfg.shard_id}"


def lease_role_label(cfg: Config) -> str:
    return "listener" if cfg.worker_role == "listener" else cfg.worker_role
