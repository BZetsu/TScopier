"""Postgres session lease helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from .config import Config, lease_role_label, listener_worker_id


def _expires_at_iso(cfg: Config) -> str:
    return (datetime.now(timezone.utc) + timedelta(milliseconds=cfg.lease_ttl_ms)).isoformat()


async def acquire_session_lease(supabase: Client, cfg: Config, user_id: str) -> tuple[bool, str]:
    worker_id = listener_worker_id(cfg)
    expires_at = _expires_at_iso(cfg)

    try:
        result = supabase.rpc(
            "acquire_worker_session_lease",
            {
                "p_user_id": user_id,
                "p_worker_id": worker_id,
                "p_role": lease_role_label(cfg),
                "p_shard_id": cfg.shard_id,
                "p_shard_count": cfg.shard_count,
                "p_expires_at": expires_at,
            },
        ).execute()
        if result.data is True:
            return True, ""
    except Exception as exc:
        return _acquire_legacy(supabase, cfg, user_id, str(exc))

    existing = (
        supabase.table("worker_session_leases")
        .select("worker_id, expires_at")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    row = existing.data
    if row:
        held = row.get("worker_id", "")
        exp = row.get("expires_at", "")
        return False, f"lease held by {held} until {exp}"
    return False, "lease acquire rejected"


def _acquire_legacy(supabase: Client, cfg: Config, user_id: str, rpc_err: str) -> tuple[bool, str]:
    worker_id = listener_worker_id(cfg)
    existing = (
        supabase.table("worker_session_leases")
        .select("worker_id, expires_at")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    row = existing.data
    if row:
        exp = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
        held = str(row.get("worker_id", ""))
        if exp.timestamp() > datetime.now(timezone.utc).timestamp() and held != worker_id:
            return False, f"lease held by {held} until {row.get('expires_at')}"

    supabase.table("worker_session_leases").upsert(
        {
            "user_id": user_id,
            "worker_id": worker_id,
            "role": lease_role_label(cfg),
            "shard_id": cfg.shard_id,
            "shard_count": cfg.shard_count,
            "expires_at": _expires_at_iso(cfg),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id",
    ).execute()
    return True, ""


def renew_session_lease(supabase: Client, cfg: Config, user_id: str) -> None:
    worker_id = listener_worker_id(cfg)
    supabase.table("worker_session_leases").update(
        {
            "worker_id": worker_id,
            "expires_at": _expires_at_iso(cfg),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("user_id", user_id).eq("worker_id", worker_id).execute()


def release_session_lease(supabase: Client, cfg: Config, user_id: str) -> None:
    worker_id = listener_worker_id(cfg)
    supabase.table("worker_session_leases").delete().eq("user_id", user_id).eq(
        "worker_id", worker_id
    ).execute()


def list_active_leases(supabase: Client) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    result = supabase.table("worker_session_leases").select("*").gt("expires_at", now).execute()
    return list(result.data or [])
