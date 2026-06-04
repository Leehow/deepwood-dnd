"""
Player-to-Player Trade Handler
WebSocket-based real-time trading system between player characters.

Trade flow:
  1. Player A sends trade_request → target player sees notification
  2. Target accepts/rejects
  3. Both sides update offers (items + currency) in real-time
  4. Both lock → server executes atomic swap
"""
import uuid
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.character import Character
from app.services.realtime_publisher import realtime_publisher
from app.utils.item_payload_normalizer import items_can_stack
from .base import MessageHandler

# In-memory active trade sessions: {trade_id: TradeSession}
_active_trades: Dict[str, dict] = {}
# Reverse lookup: user in campaign → trade_id (prevent duplicate trades)
_user_trade_map: Dict[str, str] = {}  # "campaign_id:user_id" → trade_id


def _user_key(campaign_id: str, user_id: str) -> str:
    return f"{campaign_id}:{user_id}"


class TradeHandler(MessageHandler):
    """Handles all trade_* message types"""

    async def handle(
        self, message: Dict[str, Any], websocket: WebSocket,
        campaign_id: str, user_id: str, role: str, db: AsyncSession
    ) -> None:
        msg_type = message.get("type", "")
        data = message.get("data", {})
        sub = msg_type.replace("trade_", "")

        handlers = {
            "request": self._handle_request,
            "accept": self._handle_accept,
            "reject": self._handle_reject,
            "update": self._handle_update,
            "lock": self._handle_lock,
            "unlock": self._handle_unlock,
            "cancel": self._handle_cancel,
        }
        handler = handlers.get(sub)
        if not handler:
            await self._send_error(websocket, f"Unknown trade action: {sub}")
            return
        await handler(data, websocket, campaign_id, user_id, db)

    # ── trade_request ──────────────────────────────────────────────
    async def _handle_request(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        target_user_id = str(data.get("target_user_id", ""))
        source_char_id = data.get("source_character_id")
        target_char_id = data.get("target_character_id")
        source_char_name = data.get("source_character_name", "")

        if not target_user_id or not source_char_id or not target_char_id:
            await self._send_error(ws, "缺少交易参数")
            return

        if target_user_id == user_id:
            await self._send_error(ws, "不能与自己交易")
            return

        # Check no active trade for either party
        src_key = _user_key(campaign_id, user_id)
        tgt_key = _user_key(campaign_id, target_user_id)
        if src_key in _user_trade_map:
            await self._send_error(ws, "你已经有一笔进行中的交易")
            return
        if tgt_key in _user_trade_map:
            await self._send_error(ws, "对方正在交易中")
            return

        # Verify characters exist
        res = await db.execute(
            select(Character.id, Character.name).where(Character.id.in_([int(source_char_id), int(target_char_id)]))
        )
        chars = {r.id: r.name for r in res.all()}
        if int(source_char_id) not in chars or int(target_char_id) not in chars:
            await self._send_error(ws, "角色不存在")
            return

        # Check if target user is online
        from app.services.websocket_manager import manager
        online_users = manager.get_online_users(campaign_id)
        if target_user_id not in online_users:
            await self._send_error(ws, "对方不在线，无法发起交易")
            return

        trade_id = str(uuid.uuid4())[:8]
        session = {
            "trade_id": trade_id,
            "campaign_id": campaign_id,
            "status": "pending",
            "initiator": {"user_id": user_id, "character_id": int(source_char_id), "character_name": chars[int(source_char_id)]},
            "target": {"user_id": target_user_id, "character_id": int(target_char_id), "character_name": chars[int(target_char_id)]},
            "offers": {
                user_id: {"items": [], "currency": {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}},
                target_user_id: {"items": [], "currency": {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}},
            },
            "locked": {user_id: False, target_user_id: False},
        }
        _active_trades[trade_id] = session
        _user_trade_map[src_key] = trade_id
        _user_trade_map[tgt_key] = trade_id

        target_char_name = chars[int(target_char_id)]

        # Notify the target player
        await self.broadcast_to_users({
            "type": "trade_request",
            "data": {
                "trade_id": trade_id,
                "from_user_id": user_id,
                "from_character_id": int(source_char_id),
                "from_character_name": source_char_name or chars[int(source_char_id)],
                "target_character_id": int(target_char_id),
                "target_character_name": target_char_name,
            },
        }, campaign_id, [target_user_id])

        # Send confirmation back to the initiator
        await self.send_to_websocket({
            "type": "trade_request_sent",
            "data": {
                "trade_id": trade_id,
                "target_character_name": target_char_name,
            },
        }, ws)

    # ── trade_accept ───────────────────────────────────────────────
    async def _handle_accept(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session:
            await self._send_error(ws, "交易不存在或已结束")
            return
        if session["target"]["user_id"] != user_id:
            await self._send_error(ws, "只有被邀请方可以接受交易")
            return
        if session["status"] != "pending":
            await self._send_error(ws, "该交易已不在等待状态")
            return

        session["status"] = "active"
        both = [session["initiator"]["user_id"], session["target"]["user_id"]]
        await self.broadcast_to_users({
            "type": "trade_accept",
            "data": {
                "trade_id": session["trade_id"],
                "initiator": session["initiator"],
                "target": session["target"],
            },
        }, campaign_id, both)

    # ── trade_reject ───────────────────────────────────────────────
    async def _handle_reject(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session:
            await self._send_error(ws, "交易不存在或已结束")
            return

        other_id = self._other_user(session, user_id)
        self._cleanup_session(session)
        await self.broadcast_to_users({
            "type": "trade_reject",
            "data": {"trade_id": data.get("trade_id"), "rejected_by": user_id},
        }, campaign_id, [other_id])

    # ── trade_update ───────────────────────────────────────────────
    async def _handle_update(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session or session["status"] != "active":
            await self._send_error(ws, "交易不存在或不在进行中")
            return
        if session["locked"].get(user_id):
            await self._send_error(ws, "已锁定报价，请先解锁再修改")
            return

        # Update this user's offer
        offer = data.get("offer", {})
        session["offers"][user_id] = {
            "items": offer.get("items", []),
            "currency": offer.get("currency", {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}),
        }

        other_id = self._other_user(session, user_id)
        await realtime_publisher.publish_trade_updated(
            campaign_id,
            data={
                "trade_id": session["trade_id"],
                "from_user_id": user_id,
                "offer": session["offers"][user_id],
            },
            recipients=[other_id],
        )

    # ── trade_lock / unlock ────────────────────────────────────────
    async def _handle_lock(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session or session["status"] != "active":
            await self._send_error(ws, "交易不存在或不在进行中")
            return

        session["locked"][user_id] = True
        other_id = self._other_user(session, user_id)
        both = [session["initiator"]["user_id"], session["target"]["user_id"]]

        await self.broadcast_to_users({
            "type": "trade_lock",
            "data": {"trade_id": session["trade_id"], "user_id": user_id},
        }, campaign_id, [other_id])

        # If both locked → execute trade
        if all(session["locked"].values()):
            await self._execute_trade(session, both, campaign_id, db)

    async def _handle_unlock(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session or session["status"] != "active":
            await self._send_error(ws, "交易不存在或不在进行中")
            return

        session["locked"][user_id] = False
        other_id = self._other_user(session, user_id)
        await self.broadcast_to_users({
            "type": "trade_unlock",
            "data": {"trade_id": session["trade_id"], "user_id": user_id},
        }, campaign_id, [other_id])

    # ── trade_cancel ───────────────────────────────────────────────
    async def _handle_cancel(
        self, data: dict, ws: WebSocket, campaign_id: str, user_id: str, db: AsyncSession
    ) -> None:
        session = self._get_session(data.get("trade_id"), campaign_id, user_id)
        if not session:
            return  # Already cleaned up

        other_id = self._other_user(session, user_id)
        self._cleanup_session(session)
        await self.broadcast_to_users({
            "type": "trade_cancel",
            "data": {"trade_id": data.get("trade_id"), "cancelled_by": user_id},
        }, campaign_id, [other_id])

    # ── Execute Trade (atomic swap) ────────────────────────────────
    async def _execute_trade(
        self, session: dict, both_user_ids: list, campaign_id: str, db: AsyncSession
    ) -> None:
        init_uid = session["initiator"]["user_id"]
        tgt_uid = session["target"]["user_id"]
        init_cid = session["initiator"]["character_id"]
        tgt_cid = session["target"]["character_id"]

        # Fetch both characters fresh from DB
        res = await db.execute(select(Character).where(Character.id.in_([init_cid, tgt_cid])))
        chars = {c.id: c for c in res.scalars().all()}
        char_a = chars.get(init_cid)
        char_b = chars.get(tgt_cid)
        if not char_a or not char_b:
            self._cleanup_session(session)
            await self.broadcast_to_users({
                "type": "trade_error",
                "data": {"trade_id": session["trade_id"], "message": "角色数据异常，交易失败"},
            }, campaign_id, both_user_ids)
            return

        offer_a = session["offers"][init_uid]  # What A gives
        offer_b = session["offers"][tgt_uid]   # What B gives

        # Validate items still in equipment & currency sufficient
        error = self._validate_offer(char_a, offer_a) or self._validate_offer(char_b, offer_b)
        if error:
            self._cleanup_session(session)
            await self.broadcast_to_users({
                "type": "trade_error",
                "data": {"trade_id": session["trade_id"], "message": error},
            }, campaign_id, both_user_ids)
            return

        # Perform swap
        equip_a = list(char_a.equipment or [])
        equip_b = list(char_b.equipment or [])
        cur_a = dict(char_a.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})
        cur_b = dict(char_b.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})

        # Remove A's offered items from A, add to B
        self._remove_items(equip_a, offer_a["items"])
        self._add_items(equip_b, offer_a["items"])
        self._transfer_currency(cur_a, cur_b, offer_a["currency"])

        # Remove B's offered items from B, add to A
        self._remove_items(equip_b, offer_b["items"])
        self._add_items(equip_a, offer_b["items"])
        self._transfer_currency(cur_b, cur_a, offer_b["currency"])

        # Force SQLAlchemy update via explicit UPDATE statements
        await db.execute(update(Character).where(Character.id == init_cid).values(
            equipment=equip_a, currency=cur_a
        ))
        await db.execute(update(Character).where(Character.id == tgt_cid).values(
            equipment=equip_b, currency=cur_b
        ))
        await db.commit()

        self._cleanup_session(session)

        # Notify both parties
        await self.broadcast_to_users({
            "type": "trade_confirm",
            "data": {"trade_id": session["trade_id"], "success": True},
        }, campaign_id, both_user_ids)

        # Broadcast character_updated so UI refreshes
        for cid in [init_cid, tgt_cid]:
            await realtime_publisher.publish_character_updated(
                campaign_id,
                data={"character_id": cid},
            )

    # ── Validation helpers ─────────────────────────────────────────
    def _validate_offer(self, char: Character, offer: dict) -> str | None:
        """Return error message if offer is invalid, None if ok."""
        equip = char.equipment if isinstance(char.equipment, list) else []
        cur = char.currency or {}

        # Check currency
        for denom in ("cp", "sp", "ep", "gp", "pp"):
            if int(offer["currency"].get(denom, 0)) > int(cur.get(denom, 0)):
                return f"{char.name} 的 {denom.upper()} 不足"

        # Check items exist with sufficient quantity
        for item in offer["items"]:
            found = False
            for eq in equip:
                if not isinstance(eq, dict):
                    continue
                if self._items_match(eq, item):
                    if int(eq.get("quantity", 1)) < int(item.get("quantity", 1)):
                        return f"{char.name} 的 {item.get('name', '物品')} 数量不足"
                    found = True
                    break
            if not found:
                return f"{char.name} 没有 {item.get('name', '物品')}"
        return None

    def _items_match(self, eq: dict, item: dict) -> bool:
        """Check if equipment entry matches a trade item."""
        if eq.get("equippedSlot"):
            return False
        return items_can_stack(eq, item)

    def _remove_items(self, equip: list, items: list) -> None:
        for item in items:
            qty_to_remove = int(item.get("quantity", 1))
            for eq in equip:
                if not isinstance(eq, dict):
                    continue
                if self._items_match(eq, item):
                    current_qty = int(eq.get("quantity", 1))
                    if current_qty <= qty_to_remove:
                        equip.remove(eq)
                    else:
                        eq["quantity"] = current_qty - qty_to_remove
                    break

    def _add_items(self, equip: list, items: list) -> None:
        for item in items:
            qty = int(item.get("quantity", 1))
            # Try stacking into existing unequipped slot
            stacked = False
            for eq in equip:
                if not isinstance(eq, dict):
                    continue
                if self._items_match(eq, item):
                    eq["quantity"] = int(eq.get("quantity", 1)) + qty
                    stacked = True
                    break
            if not stacked:
                new_entry = dict(item)
                new_entry["quantity"] = qty
                new_entry.pop("equippedSlot", None)
                equip.append(new_entry)

    def _transfer_currency(self, from_cur: dict, to_cur: dict, amount: dict) -> None:
        for denom in ("cp", "sp", "ep", "gp", "pp"):
            val = int(amount.get(denom, 0))
            if val > 0:
                from_cur[denom] = int(from_cur.get(denom, 0)) - val
                to_cur[denom] = int(to_cur.get(denom, 0)) + val

    # ── Session helpers ────────────────────────────────────────────
    def _get_session(self, trade_id: str | None, campaign_id: str, user_id: str) -> dict | None:
        if not trade_id:
            return None
        session = _active_trades.get(trade_id)
        if not session or session["campaign_id"] != campaign_id:
            return None
        if user_id not in (session["initiator"]["user_id"], session["target"]["user_id"]):
            return None
        return session

    def _other_user(self, session: dict, user_id: str) -> str:
        if session["initiator"]["user_id"] == user_id:
            return session["target"]["user_id"]
        return session["initiator"]["user_id"]

    def _cleanup_session(self, session: dict) -> None:
        trade_id = session["trade_id"]
        cid = session["campaign_id"]
        _user_trade_map.pop(_user_key(cid, session["initiator"]["user_id"]), None)
        _user_trade_map.pop(_user_key(cid, session["target"]["user_id"]), None)
        _active_trades.pop(trade_id, None)

    async def _send_error(self, ws: WebSocket, msg: str) -> None:
        await self.send_to_websocket({"type": "trade_error", "data": {"message": msg}}, ws)


async def cleanup_user_trades(campaign_id: str, user_id: str) -> None:
    """Called on disconnect — cancel any active trade for this user."""
    key = _user_key(campaign_id, user_id)
    trade_id = _user_trade_map.get(key)
    if not trade_id:
        return
    session = _active_trades.get(trade_id)
    if not session:
        _user_trade_map.pop(key, None)
        return

    other_id = session["target"]["user_id"] if session["initiator"]["user_id"] == user_id else session["initiator"]["user_id"]

    # Cleanup
    _user_trade_map.pop(_user_key(campaign_id, session["initiator"]["user_id"]), None)
    _user_trade_map.pop(_user_key(campaign_id, session["target"]["user_id"]), None)
    _active_trades.pop(trade_id, None)

    # Notify the other party
    from app.services.websocket_manager import manager
    try:
        await manager.send_to_users({
            "type": "trade_cancel",
            "data": {"trade_id": trade_id, "cancelled_by": user_id, "reason": "对方已断开连接"},
        }, campaign_id, [other_id])
    except Exception:
        pass
