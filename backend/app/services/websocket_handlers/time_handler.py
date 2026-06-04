"""
Time of Day Handler
Handles time_update messages for campaign map time/lighting
"""
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.campaign import Campaign
from app.services.websocket_manager import manager
from app.services.world_time_settlement import settle_world_time

from .base import MessageHandler

logger = logging.getLogger(__name__)


SYNC_ACK_TIMEOUT_SECONDS = 1.0


@dataclass
class TimeSyncSession:
    campaign_id: str
    sync_seq: int
    dm_user_id: str
    expected_users: set[str] = field(default_factory=set)
    acked_users: set[str] = field(default_factory=set)
    timeout_task: asyncio.Task | None = None


class TimeHandler(MessageHandler):
    """Handler for time of day updates"""

    def __init__(self) -> None:
        self._sync_sessions: dict[str, TimeSyncSession] = {}
        self._sync_lock = asyncio.Lock()

    async def handle(
        self,
        message: dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        message_type = message.get("type")
        if message_type == "time_update_ack":
            await self._handle_time_update_ack(message, campaign_id, user_id)
            return

        data = message.get("data") or {}
        cycle = data.get("cycle", "day")
        hour = int(data.get("hour", 12))
        minute = int(data.get("minute", 0))
        second = int(data.get("second", 0))
        day = int(data.get("day", 123))
        real_time_active = data.get("realTimeActive", False)
        environment = data.get("environment", "normal")
        sync_seq = self._parse_sync_seq(data.get("sync_seq"))
        requires_sync_ack = bool(data.get("requires_sync_ack")) and role == "dm" and sync_seq is not None
        sync_mode = data.get("sync_mode")
        settlement_rounds = self._parse_settlement_rounds(data)

        time_data = {
            "cycle": cycle, "hour": hour, "minute": minute,
            "second": second, "day": day, "realTimeActive": real_time_active,
            "environment": environment,
        }
        broadcast_data = dict(time_data)
        if sync_seq is not None:
            broadcast_data["sync_seq"] = sync_seq
        if requires_sync_ack:
            broadcast_data["requires_sync_ack"] = True
        if isinstance(sync_mode, str) and sync_mode:
            broadcast_data["sync_mode"] = sync_mode

        # Persist to campaign metadata
        result = await db.execute(
            select(Campaign).where(Campaign.id == int(campaign_id))
        )
        campaign = result.scalar_one_or_none()
        if campaign:
            meta = campaign.meta or {}
            meta["time_of_day"] = time_data
            campaign.meta = meta
            flag_modified(campaign, "meta")
            await db.commit()
            # Single settlement owner: world time changed, settle all time-bound
            # rules (due casts, token effect expiry, concentration, runtime).
            await settle_world_time(
                db,
                int(campaign_id),
                time_data,
                map_url=None,
                rounds=settlement_rounds,
                source="time_update",
            )

        if requires_sync_ack and sync_seq is not None:
            await self._start_time_sync_session(campaign_id, sync_seq, user_id)

        # Broadcast to all clients (including sender for confirmation)
        await self.broadcast_to_campaign(
            {"type": "time_update", "data": broadcast_data},
            campaign_id,
        )

        logger.debug(f"[TimeHandler] Updated time to day {day} {hour:02d}:{minute:02d}:{second:02d} ({cycle}, env={environment}) for campaign {campaign_id}")

    # Canonical settlement-round metadata field on time_update.data, plus one
    # compatibility alias. Tells the single settlement owner how many rounds
    # this visible time advance represents so legacy per-round duration
    # decrement runs exactly once server-side (wall-clock expiry is settled
    # regardless). Not persisted into campaign.meta["time_of_day"]; not echoed
    # into the broadcast world-time shape.
    _SETTLEMENT_ROUND_KEYS = ("settlement_rounds", "advance_rounds")

    @classmethod
    def _parse_settlement_rounds(cls, data: dict[str, Any]) -> int:
        """Parse a nonnegative settlement-round count from time_update.data.

        bool / None / non-numeric / NaN-like / negative all settle to 0 so a
        malformed client field can never trigger spurious per-round decrement.
        """
        for key in cls._SETTLEMENT_ROUND_KEYS:
            if key not in data:
                continue
            value = data.get(key)
            if value is None or isinstance(value, bool):
                return 0
            try:
                rounds = int(value)
            except (TypeError, ValueError, OverflowError):
                return 0
            return rounds if rounds > 0 else 0
        return 0

    @staticmethod
    def _parse_sync_seq(value: Any) -> int | None:
        if value is None or isinstance(value, bool):
            return None
        try:
            sync_seq = int(value)
        except (TypeError, ValueError):
            return None
        return sync_seq if sync_seq >= 0 else None

    async def _start_time_sync_session(self, campaign_id: str, sync_seq: int, dm_user_id: str) -> None:
        commit_payload: dict[str, Any] | None = None
        campaign_key = str(campaign_id)
        async with self._sync_lock:
            prev_session = self._sync_sessions.pop(campaign_key, None)
            if prev_session and prev_session.timeout_task:
                prev_session.timeout_task.cancel()

            expected_users = set(manager.get_online_users(campaign_key))
            session = TimeSyncSession(
                campaign_id=campaign_key,
                sync_seq=sync_seq,
                dm_user_id=str(dm_user_id),
                expected_users=expected_users,
                acked_users={str(dm_user_id)},
            )

            if session.expected_users.issubset(session.acked_users):
                commit_payload = self._finalize_session_unlocked(campaign_key, session, reason="all_acked")
            else:
                session.timeout_task = asyncio.create_task(
                    self._timeout_time_sync_session(campaign_key, sync_seq)
                )
                self._sync_sessions[campaign_key] = session

        if commit_payload:
            await self._notify_time_sync_committed(commit_payload)

    async def _handle_time_update_ack(self, message: dict[str, Any], campaign_id: str, user_id: str) -> None:
        data = message.get("data") or {}
        sync_seq = self._parse_sync_seq(data.get("sync_seq"))
        if sync_seq is None:
            return

        campaign_key = str(campaign_id)
        commit_payload: dict[str, Any] | None = None
        async with self._sync_lock:
            session = self._sync_sessions.get(campaign_key)
            if not session or session.sync_seq != sync_seq:
                return

            session.acked_users.add(str(user_id))
            if session.expected_users.issubset(session.acked_users):
                commit_payload = self._finalize_session_unlocked(
                    campaign_key,
                    session,
                    reason="all_acked",
                )

        if commit_payload:
            await self._notify_time_sync_committed(commit_payload)

    async def handle_user_disconnected(self, campaign_id: str, user_id: str, role: str) -> None:
        campaign_key = str(campaign_id)
        commit_payload: dict[str, Any] | None = None
        async with self._sync_lock:
            session = self._sync_sessions.get(campaign_key)
            if not session:
                return

            if str(user_id) == session.dm_user_id:
                if session.timeout_task:
                    session.timeout_task.cancel()
                self._sync_sessions.pop(campaign_key, None)
                return

            session.expected_users.discard(str(user_id))
            session.acked_users.discard(str(user_id))
            if session.expected_users.issubset(session.acked_users):
                commit_payload = self._finalize_session_unlocked(
                    campaign_key,
                    session,
                    reason="disconnect",
                )

        if commit_payload:
            await self._notify_time_sync_committed(commit_payload)

    async def _timeout_time_sync_session(self, campaign_id: str, sync_seq: int) -> None:
        try:
            await asyncio.sleep(SYNC_ACK_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            return

        commit_payload: dict[str, Any] | None = None
        async with self._sync_lock:
            session = self._sync_sessions.get(campaign_id)
            if not session or session.sync_seq != sync_seq:
                return
            commit_payload = self._finalize_session_unlocked(campaign_id, session, reason="timeout")

        if commit_payload:
            await self._notify_time_sync_committed(commit_payload)

    def _finalize_session_unlocked(
        self,
        campaign_id: str,
        session: TimeSyncSession,
        *,
        reason: str,
    ) -> dict[str, Any]:
        self._sync_sessions.pop(campaign_id, None)
        if session.timeout_task:
            session.timeout_task.cancel()

        acked_expected_users = sorted(session.expected_users.intersection(session.acked_users))
        pending_users = sorted(session.expected_users.difference(session.acked_users))
        return {
            "campaign_id": session.campaign_id,
            "dm_user_id": session.dm_user_id,
            "sync_seq": session.sync_seq,
            "reason": reason,
            "expected_user_count": len(session.expected_users),
            "acked_user_count": len(acked_expected_users),
            "acked_user_ids": acked_expected_users,
            "pending_user_ids": pending_users,
        }

    async def _notify_time_sync_committed(self, payload: dict[str, Any]) -> None:
        campaign_id = payload["campaign_id"]
        dm_user_id = payload["dm_user_id"]
        message_data = {
            "sync_seq": payload["sync_seq"],
            "reason": payload["reason"],
            "expected_user_count": payload["expected_user_count"],
            "acked_user_count": payload["acked_user_count"],
            "acked_user_ids": payload["acked_user_ids"],
            "pending_user_ids": payload["pending_user_ids"],
        }
        await manager.send_to_users(
            {"type": "time_update_committed", "data": message_data},
            campaign_id,
            [dm_user_id],
        )
