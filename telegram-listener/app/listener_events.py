"""Listener audit events."""

from __future__ import annotations

from typing import Any

from supabase import Client


def persist_listener_event(
    supabase: Client,
    *,
    user_id: str,
    event_type: str,
    channel_row_id: str | None = None,
    telegram_message_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    try:
        supabase.table("listener_events").insert(
            {
                "user_id": user_id,
                "channel_row_id": channel_row_id,
                "telegram_message_id": telegram_message_id,
                "event_type": event_type,
                "detail": detail or {},
            }
        ).execute()
    except Exception as exc:
        print(f"[listener_events] insert failed type={event_type}: {exc}")
