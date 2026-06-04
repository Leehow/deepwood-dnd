"""
WebSocket message batching service for performance optimization.
Batches messages within a 50ms window to reduce network overhead.
"""

import asyncio
from typing import Dict, List, Any, Set
from datetime import datetime
from fastapi import WebSocket


class MessageBatcher:
    """
    Batches WebSocket messages for efficient delivery.

    Instead of sending each message immediately, messages are queued
    and sent in batches after a configurable window (default 50ms).
    """

    def __init__(self, batch_window_ms: int = 50, max_batch_size: int = 100):
        self.batch_window_ms = batch_window_ms
        self.max_batch_size = max_batch_size

        # Message queues per campaign
        self._queues: Dict[str, List[Dict[str, Any]]] = {}

        # Flush tasks per campaign
        self._flush_tasks: Dict[str, asyncio.Task] = {}

        # Active connections per campaign
        self._connections: Dict[str, Set[WebSocket]] = {}

        # Lock for thread safety
        self._lock = asyncio.Lock()

    async def add_connection(self, campaign_id: str, websocket: WebSocket):
        """Register a WebSocket connection for a campaign."""
        async with self._lock:
            if campaign_id not in self._connections:
                self._connections[campaign_id] = set()
            self._connections[campaign_id].add(websocket)

    async def remove_connection(self, campaign_id: str, websocket: WebSocket):
        """Remove a WebSocket connection from a campaign."""
        async with self._lock:
            if campaign_id in self._connections:
                self._connections[campaign_id].discard(websocket)
                if not self._connections[campaign_id]:
                    del self._connections[campaign_id]

    async def queue_message(
        self,
        campaign_id: str,
        message: Dict[str, Any],
        exclude_sender: WebSocket = None
    ):
        """
        Queue a message for batched delivery.

        Args:
            campaign_id: Target campaign ID
            message: Message to send
            exclude_sender: WebSocket to exclude from broadcast
        """
        async with self._lock:
            # Initialize queue if needed
            if campaign_id not in self._queues:
                self._queues[campaign_id] = []

            # Add message with metadata
            self._queues[campaign_id].append({
                "message": message,
                "exclude_sender": exclude_sender,
                "queued_at": datetime.utcnow().isoformat()
            })

            # Start flush task if not running
            if campaign_id not in self._flush_tasks or self._flush_tasks[campaign_id].done():
                self._flush_tasks[campaign_id] = asyncio.create_task(
                    self._schedule_flush(campaign_id)
                )

            # Flush immediately if batch is full
            if len(self._queues[campaign_id]) >= self.max_batch_size:
                await self._flush_queue(campaign_id)

    async def _schedule_flush(self, campaign_id: str):
        """Schedule a flush after the batch window."""
        await asyncio.sleep(self.batch_window_ms / 1000)
        await self._flush_queue(campaign_id)

    async def _flush_queue(self, campaign_id: str):
        """Flush all queued messages for a campaign."""
        async with self._lock:
            if campaign_id not in self._queues or not self._queues[campaign_id]:
                return

            # Get queued messages
            queued_items = self._queues[campaign_id]
            self._queues[campaign_id] = []

            # Get connections
            connections = self._connections.get(campaign_id, set()).copy()

            if not connections:
                return

            # Group messages by type for efficient batching
            batched_messages = self._batch_messages(queued_items)

            # Send batched messages
            for ws in connections:
                try:
                    # Filter messages that should be sent to this connection
                    messages_for_ws = [
                        item for item in batched_messages
                        if not any(
                            q["exclude_sender"] == ws
                            for q in queued_items
                            if q["message"]["type"] == item["type"]
                        )
                    ]

                    if messages_for_ws:
                        # Send as batch if multiple messages
                        if len(messages_for_ws) > 1:
                            await ws.send_json({
                                "type": "batch",
                                "messages": messages_for_ws,
                                "count": len(messages_for_ws)
                            })
                        else:
                            await ws.send_json(messages_for_ws[0])

                except Exception:
                    # Connection might be closed
                    pass

    def _batch_messages(self, queued_items: List[Dict]) -> List[Dict[str, Any]]:
        """
        Batch messages by type, merging where possible.

        For example, multiple token_move messages for the same token
        can be merged into a single message with the final position.
        """
        # Group by message type
        by_type: Dict[str, List[Dict]] = {}
        for item in queued_items:
            msg_type = item["message"]["type"]
            if msg_type not in by_type:
                by_type[msg_type] = []
            by_type[msg_type].append(item["message"])

        batched = []

        for msg_type, messages in by_type.items():
            # Merge strategies for specific message types
            if msg_type == "token_move":
                # Keep only the last position for each token
                merged = self._merge_token_moves(messages)
                batched.extend(merged)
            elif msg_type == "cursor_move":
                # Keep only the last cursor position for each user
                merged = self._merge_cursor_moves(messages)
                batched.extend(merged)
            elif msg_type in ["fog_update", "drawing_updated"]:
                # These can be batched together
                batched.append({
                    "type": f"{msg_type}_batch",
                    "updates": messages
                })
            else:
                # No merging, send all messages
                batched.extend(messages)

        return batched

    def _merge_token_moves(self, messages: List[Dict]) -> List[Dict]:
        """Merge multiple token_move messages, keeping last position per token."""
        token_positions: Dict[str, Dict] = {}

        for msg in messages:
            token_id = msg.get("token_id") or msg.get("data", {}).get("token_id")
            if token_id:
                token_positions[token_id] = msg

        return list(token_positions.values())

    def _merge_cursor_moves(self, messages: List[Dict]) -> List[Dict]:
        """Merge multiple cursor_move messages, keeping last position per user."""
        user_cursors: Dict[str, Dict] = {}

        for msg in messages:
            user_id = msg.get("user_id") or msg.get("data", {}).get("user_id")
            if user_id:
                user_cursors[user_id] = msg

        return list(user_cursors.values())

    async def flush_all(self):
        """Flush all campaign queues immediately."""
        campaign_ids = list(self._queues.keys())
        for campaign_id in campaign_ids:
            await self._flush_queue(campaign_id)

    def get_stats(self) -> Dict[str, Any]:
        """Get batching statistics."""
        return {
            "active_campaigns": len(self._queues),
            "total_connections": sum(len(c) for c in self._connections.values()),
            "pending_messages": sum(len(q) for q in self._queues.values()),
            "batch_window_ms": self.batch_window_ms,
            "max_batch_size": self.max_batch_size
        }


# Global instance
message_batcher = MessageBatcher()


# Helper function for easy integration
async def batch_broadcast(
    campaign_id: str,
    message: Dict[str, Any],
    exclude_sender: WebSocket = None
):
    """
    Queue a message for batched broadcast.

    Usage:
        await batch_broadcast(campaign_id, {"type": "token_move", "data": {...}})
    """
    await message_batcher.queue_message(campaign_id, message, exclude_sender)