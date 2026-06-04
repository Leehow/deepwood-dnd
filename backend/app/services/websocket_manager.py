import asyncio
import logging
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

logger = logging.getLogger(__name__)


def normalize_campaign_id(campaign_id: str | int) -> str:
    """
    Normalize campaign_id to string type for consistent WebSocket connection management.

    Args:
        campaign_id: Campaign ID as string or integer

    Returns:
        Campaign ID as string
    """
    return str(campaign_id)


def normalize_ws_message(message: dict) -> dict:
    """Normalize outgoing WebSocket payload to a single canonical shape.

    Canonical message format:
    - type: str
    - data: dict (always present)

    Any extra top-level keys will be merged into data, and the returned dict
    will contain only {"type", "data"}.
    """
    if not isinstance(message, dict):
        return {"type": "error", "data": {"message": "Invalid message"}}

    msg_type = message.get("type")
    if not msg_type:
        return {"type": "error", "data": {"message": "Message type is required"}}

    data = message.get("data")
    if data is None:
        data = {}
    if not isinstance(data, dict):
        data = {"value": data}

    # Merge any other top-level fields into data
    for k, v in message.items():
        if k in ("type", "data"):
            continue
        if k not in data:
            data[k] = v

    return {"type": msg_type, "data": data}


class ConnectionManager:
    """WebSocket connection manager for real-time communication"""

    def __init__(self):
        # Store active connections by campaign_id
        self.active_connections: dict[str, set[WebSocket]] = {}
        # Store user info for each connection
        self.connection_info: dict[WebSocket, dict] = {}
        self.disconnect_listeners: list[Callable[[str, str, str], Awaitable[None] | None]] = []

    def register_disconnect_listener(
        self,
        listener: Callable[[str, str, str], Awaitable[None] | None],
    ) -> None:
        if listener not in self.disconnect_listeners:
            self.disconnect_listeners.append(listener)

    def unregister_disconnect_listener(
        self,
        listener: Callable[[str, str, str], Awaitable[None] | None],
    ) -> None:
        if listener in self.disconnect_listeners:
            self.disconnect_listeners.remove(listener)

    async def connect(
        self,
        websocket: WebSocket,
        campaign_id: str | int,
        user_id: str,
        role: str,
        selected_character_id: int | None = None,
        locale: str | None = None,
        locale_source: str | None = None,
    ):
        """Accept and store a new WebSocket connection"""
        await websocket.accept()

        # Normalize campaign_id to string
        campaign_id = normalize_campaign_id(campaign_id)

        # Add to campaign connections
        if campaign_id not in self.active_connections:
            self.active_connections[campaign_id] = set()
        self.active_connections[campaign_id].add(websocket)

        # Store connection info
        self.connection_info[websocket] = {
            "campaign_id": campaign_id,
            "user_id": user_id,
            "role": role,
            "selected_character_id": selected_character_id,
            "locale": locale,
            "locale_source": locale_source,
        }

    def get_locale(self, websocket: WebSocket) -> str | None:
        """Return the locale stored for a connection, if any."""
        info = self.connection_info.get(websocket)
        if not info:
            return None
        value = info.get("locale")
        return value if isinstance(value, str) else None

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.connection_info:
            info = self.connection_info[websocket]
            campaign_id = info["campaign_id"]
            user_id = info.get("user_id")
            role = info.get("role")

            # Remove from campaign connections
            if campaign_id in self.active_connections:
                self.active_connections[campaign_id].discard(websocket)
                # Clean up empty campaign sets
                if not self.active_connections[campaign_id]:
                    del self.active_connections[campaign_id]

            # Remove connection info
            del self.connection_info[websocket]

            if user_id:
                self._notify_disconnect_listeners(campaign_id, user_id, role or "player")

    def _notify_disconnect_listeners(self, campaign_id: str, user_id: str, role: str) -> None:
        for listener in list(self.disconnect_listeners):
            try:
                result = listener(campaign_id, user_id, role)
                if asyncio.iscoroutine(result):
                    asyncio.get_running_loop().create_task(result)
            except RuntimeError:
                continue
            except Exception:
                logger.exception("Error notifying disconnect listener")

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Send a message to a specific connection"""
        try:
            message = normalize_ws_message(message)
            # Check if websocket is still connected
            if websocket.client_state.name != "CONNECTED":
                self.disconnect(websocket)
                return
            await websocket.send_json(message)
        except Exception:
            logger.exception("Error sending message to websocket")
            self.disconnect(websocket)

    async def broadcast_to_campaign(self, message: dict, campaign_id: str | int, exclude: WebSocket | None = None):
        """Broadcast a message to all connections in a campaign"""
        message = normalize_ws_message(message)
        # Normalize campaign_id to string
        campaign_id = normalize_campaign_id(campaign_id)

        if campaign_id not in self.active_connections:
            return

        # Create list to avoid modification during iteration
        connections = list(self.active_connections[campaign_id])

        for connection in connections:
            if connection != exclude:
                try:
                    # Check if websocket is still connected
                    if connection.client_state.name != "CONNECTED":
                        self.disconnect(connection)
                        continue
                    await connection.send_json(message)
                except Exception:
                    logger.exception("Error broadcasting to campaign connection")
                    self.disconnect(connection)

    async def broadcast_to_role(self, message: dict, campaign_id: str | int, role: str):
        """Broadcast a message to all connections of a specific role in a campaign"""
        message = normalize_ws_message(message)
        # Normalize campaign_id to string
        campaign_id = normalize_campaign_id(campaign_id)

        if campaign_id not in self.active_connections:
            return

        connections = list(self.active_connections[campaign_id])

        for connection in connections:
            if connection in self.connection_info:
                info = self.connection_info[connection]
                if info["role"] == role:
                    try:
                        # Check if websocket is still connected
                        if connection.client_state.name != "CONNECTED":
                            self.disconnect(connection)
                            continue
                        await connection.send_json(message)
                    except Exception:
                        logger.exception("Error broadcasting to role connection")
                        self.disconnect(connection)

    async def send_to_recipients(self, message: dict, campaign_id: str | int, recipients: list[str]):
        """Send a message only to specific recipient user_ids within a campaign."""
        message = normalize_ws_message(message)
        campaign_id = normalize_campaign_id(campaign_id)
        if campaign_id not in self.active_connections:
            logger.debug("No active connections for campaign %s", campaign_id)
            return
        targets = set(recipients or [])
        if not targets:
            logger.debug("No recipients specified for campaign %s", campaign_id)
            return

        sent_count = 0
        for connection in list(self.active_connections[campaign_id]):
            info = self.connection_info.get(connection)
            if not info:
                continue
            user_id = info.get("user_id")
            # Send to targeted recipients only
            if user_id in targets:
                try:
                    # Check if websocket is still connected
                    if connection.client_state.name != "CONNECTED":
                        self.disconnect(connection)
                        continue
                    await connection.send_json(message)
                    sent_count += 1
                    logger.debug("Sent private message to recipient %s", user_id)
                except Exception:
                    logger.exception("Error sending private message to recipient")
                    self.disconnect(connection)

        logger.info("Sent private message to %s/%s recipients", sent_count, len(targets))

    async def send_to_users(self, message: dict, campaign_id: str | int, user_ids: list[str]):
        """Alias for send_to_recipients - send message to specific users"""
        await self.send_to_recipients(message, campaign_id, user_ids)

    def get_campaign_connections_count(self, campaign_id: str | int) -> int:
        """Get the number of active connections for a campaign"""
        # Normalize campaign_id to string
        campaign_id = normalize_campaign_id(campaign_id)

        if campaign_id not in self.active_connections:
            return 0
        return len(self.active_connections[campaign_id])

    def get_connection_info(self, websocket: WebSocket) -> dict:
        """Get info about a specific connection"""
        return self.connection_info.get(websocket, {})

    def get_online_users(self, campaign_id: str | int) -> list[str]:
        """Get list of unique online user IDs for a campaign"""
        campaign_id = normalize_campaign_id(campaign_id)
        if campaign_id not in self.active_connections:
            return []

        user_ids = set()
        for ws in self.active_connections[campaign_id]:
            info = self.connection_info.get(ws)
            if info and info.get("user_id"):
                user_ids.add(info["user_id"])
        return list(user_ids)

    def get_dm_user_id(self, campaign_id: str | int) -> str | None:
        """Get the DM's user_id for a campaign, if online."""
        campaign_id = normalize_campaign_id(campaign_id)
        if campaign_id not in self.active_connections:
            return None
        for ws in self.active_connections[campaign_id]:
            info = self.connection_info.get(ws)
            if info and info.get("role") == "dm":
                return info.get("user_id")
        return None


# Global connection manager instance
manager = ConnectionManager()
