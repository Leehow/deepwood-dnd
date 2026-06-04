"""
Simplified WebSocket Endpoint using Handler Registry Pattern
Original: 947 lines → Now: ~200 lines

Delegates all message handling to modular handlers
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.db.session import async_session_maker
from app.core.dependencies import (
    resolve_campaign_member_context_from_token,
    resolve_locale_context_for_user,
)
from app.core.locale import DEFAULT_LOCALE, LocaleContext
from app.services.realtime_publisher import realtime_publisher
from app.services.websocket_handlers import (
    AIMarkerHandler,
    CharacterSelectionHandler,
    ChatHandler,
    DiceHandler,
    DrawingHandler,
    FogHandler,
    MapHandler,
    RestClaimHandler,
    RestHandler,
    RewardClaimHandler,
    RewardHandler,
    RulerHandler,
    SystemNoticeHandler,
    TerrainHandler,
    TimeHandler,
    TradeHandler,
    VoiceHandler,
    registry,
)
from app.services.websocket_manager import manager

router = APIRouter()


# Register all handlers at module level
def register_handlers():
    """Register all message handlers"""
    # Chat handler
    chat_handler = ChatHandler()
    registry.register('chat', chat_handler)

    # Map and token handlers
    map_handler = MapHandler()
    registry.register('map_update', map_handler)
    registry.register('token_move', map_handler)
    registry.register('map_scale_update', map_handler)
    registry.register('grid_unit_update', map_handler)
    # Token params + hp updates
    registry.register('token_params_update', map_handler)
    registry.register('token_hp_update', map_handler)
    registry.register('roll_modifier_update', map_handler)  # DM sets advantage/disadvantage for token
    registry.register('anchor_update', map_handler)  # DM sets/clears anchor point

    # Fog of war handlers
    fog_handler = FogHandler()
    registry.register('fog_update', fog_handler)
    registry.register('fog_fill_all', fog_handler)
    registry.register('fog_clear_all', fog_handler)

    # Ruler handlers
    ruler_handler = RulerHandler()
    registry.register('ruler_added', ruler_handler)
    registry.register('ruler_removed', ruler_handler)
    registry.register('rulers_cleared', ruler_handler)

    # Drawing handlers
    drawing_handler = DrawingHandler()
    registry.register('drawing_added', drawing_handler)
    registry.register('drawing_updated', drawing_handler)
    registry.register('drawing_removed', drawing_handler)
    registry.register('drawings_cleared', drawing_handler)

    # Dice handlers
    dice_handler = DiceHandler()
    registry.register('dice_analyze', dice_handler)
    registry.register('dice_execute', dice_handler)
    registry.register('dice_roll', dice_handler)
    registry.register('dice_narrative', dice_handler)
    registry.register('dice_quick', dice_handler)  # Lightweight quick roll
    registry.register('dice_dismiss', dice_handler)  # Player dismisses dice request

    # Rest handlers
    rest_handler = RestHandler()
    registry.register('rest_grant', rest_handler)

    # Rest claim handler
    rest_claim_handler = RestClaimHandler()
    registry.register('rest_claim', rest_claim_handler)

    # Reward handler
    reward_handler = RewardHandler()
    registry.register('reward_grant', reward_handler)

    # Reward claim handler
    reward_claim_handler = RewardClaimHandler()
    registry.register('reward_claim', reward_claim_handler)

    # Character selection handler
    character_selection_handler = CharacterSelectionHandler()
    registry.register('character_selected', character_selection_handler)

    # Voice chat handlers
    voice_handler = VoiceHandler()
    registry.register('voice_join', voice_handler)
    registry.register('voice_leave', voice_handler)

    # AI marker visibility handler
    ai_marker_handler = AIMarkerHandler()
    registry.register('ai_marker_toggle', ai_marker_handler)

    # Consumable usage handler
    from app.services.websocket_handlers.consumable_handler import ConsumableHandler
    consumable_handler = ConsumableHandler()
    registry.register('consumable_use', consumable_handler)

    # Trade handlers (player-to-player trading)
    trade_handler = TradeHandler()
    for msg_type in ('trade_request', 'trade_accept', 'trade_reject',
                     'trade_update', 'trade_lock', 'trade_unlock', 'trade_cancel'):
        registry.register(msg_type, trade_handler)

    # Time of day handler
    time_handler = TimeHandler()
    registry.register('time_update', time_handler)
    registry.register('time_update_ack', time_handler)
    manager.register_disconnect_listener(time_handler.handle_user_disconnected)

    # Ephemeral campaign-wide notices
    system_notice_handler = SystemNoticeHandler()
    registry.register('system_notice', system_notice_handler)

    # Terrain handlers
    terrain_handler = TerrainHandler()
    registry.register('terrain_update', terrain_handler)
    registry.register('terrain_clear_all', terrain_handler)
    registry.register('terrain_visibility', terrain_handler)

    # Music handlers
    from app.services.websocket_handlers.music_handler import MusicHandler
    music_handler = MusicHandler()
    registry.register('music_play', music_handler)
    registry.register('music_pause', music_handler)
    registry.register('music_volume', music_handler)

    # Note: level_up is handled via HTTP API (POST /characters/{id}/level-up)
    # WebSocket only broadcasts the "character_level_up" event notification

    print("[WebSocket] Registered all message handlers")


# Register handlers when module loads
register_handlers()


@router.websocket("/ws/{campaign_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    campaign_id: int,
    token: str = Query(...),
):
    """
    WebSocket endpoint for campaign real-time communication

    Args:
        campaign_id: Campaign identifier
        token: Auth token
    """
    print(f"[WebSocket] Connection attempt: campaign_id={campaign_id}, token_present={bool(token)}")
    current_time_of_day = None
    user_id = "unknown"
    role = "player"
    selected_character_id = None
    locale_context: LocaleContext | None = None

    # Validate campaign exists before accepting WebSocket connection
    try:
        async with async_session_maker() as db:
            context = await resolve_campaign_member_context_from_token(db, campaign_id, token)
            current_time_of_day = (context.campaign.meta or {}).get("time_of_day")
            user_id = context.user_id
            role = context.role
            selected_character_id = context.selected_character_id
            # Resolve locale using the same DB session: header from the WS
            # handshake + persisted users.preferences.locale.
            accept_language = websocket.headers.get("accept-language")
            locale_context = await resolve_locale_context_for_user(
                db,
                user_id=user_id,
                accept_language=accept_language,
            )
    except HTTPException as exc:
        print(f"[WebSocket] Validation error: {exc.detail}")
        try:
            await websocket.accept()
            await manager.send_personal_message({
                "type": "error",
                "data": {"message": str(exc.detail)},
            }, websocket)
            await websocket.close(code=1008)
        except Exception:
            pass
        return
    except Exception as e:
        print(f"[WebSocket] Validation error: {e}")
        # Must accept before closing, otherwise we get "WebSocket is not connected" error
        try:
            await websocket.accept()
            await websocket.close()
        except Exception:
            pass
        return

    selected_locale = locale_context.locale if locale_context else DEFAULT_LOCALE
    locale_source = locale_context.source if locale_context else "default"

    try:
        await manager.connect(
            websocket,
            campaign_id,
            user_id,
            role,
            selected_character_id=selected_character_id,
            locale=selected_locale,
            locale_source=locale_source,
        )
    except Exception as e:
        print(f"[WebSocket] Failed to connect: {e}")
        raise

    # Heartbeat configuration
    heartbeat_interval = 30  # seconds
    last_pong_time = asyncio.get_event_loop().time()
    heartbeat_timeout = 60  # seconds - consider dead if no pong for this long

    async def send_heartbeat():
        """Send periodic heartbeat to detect connection issues"""
        nonlocal last_pong_time
        while True:
            await asyncio.sleep(heartbeat_interval)
            try:
                current_time = asyncio.get_event_loop().time()

                # Check if client is still responding
                if current_time - last_pong_time > heartbeat_timeout:
                    print(f"[WebSocket] Heartbeat timeout for user {user_id}, closing connection")
                    await websocket.close()
                    break

                # Send ping
                await manager.send_personal_message({
                    "type": "ping",
                    "data": {"timestamp": int(current_time * 1000)},
                }, websocket)
            except Exception as e:
                print(f"[WebSocket] Heartbeat error: {e}")
                break

    try:
        # Get current online users before adding this connection
        online_users = manager.get_online_users(campaign_id)

        # Send connection confirmation with online users list
        await manager.send_personal_message({
            "type": "connection",
            "data": {
                "status": "connected",
                "campaign_id": campaign_id,
                "user_id": user_id,
                "role": role,
                "selected_character_id": selected_character_id,
                "online_users": online_users,
                "time_of_day": current_time_of_day,
                "locale": selected_locale,
                "locale_source": locale_source,
            },
        }, websocket)

        print(f"[WebSocket] User {user_id} connected to campaign {campaign_id} as {role}")

        # Notify others about new connection
        await realtime_publisher.publish_user_presence(
            campaign_id,
            event_type="user_connected",
            user_id=user_id,
            role=role,
        )

        # Start heartbeat task
        heartbeat_task = asyncio.create_task(send_heartbeat())

        # Main message loop
        while True:
            try:
                # Receive message
                text = await websocket.receive_text()

                # Parse message
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    await manager.send_personal_message({
                        "type": "error",
                        "data": {"message": "Invalid JSON format"},
                    }, websocket)
                    continue

                # Get message type
                message_type = message.get("type")

                if not message_type:
                    await manager.send_personal_message({
                        "type": "error",
                        "data": {"message": "Message type is required"},
                    }, websocket)
                    continue

                # Enforce canonical message envelope for all client->server messages
                data = message.get("data")
                if not isinstance(data, dict):
                    await manager.send_personal_message(
                        {
                            "type": "error",
                            "data": {"message": "Message.data must be an object"},
                        },
                        websocket,
                    )
                    continue

                # Handle pong (client response to our ping)
                if message_type == "pong":
                    last_pong_time = asyncio.get_event_loop().time()
                    continue

                # Handle client-initiated ping
                if message_type == "ping":
                    await manager.send_personal_message({
                        "type": "pong",
                        "data": {"timestamp": data.get("timestamp")},
                    }, websocket)
                    continue

                print(f"[WebSocket] Received {message_type} from {user_id}")

                # TTS broadcast: forward audio to all clients in the campaign
                if message_type == "tts_broadcast":
                    await realtime_publisher.publish_tts_broadcast(
                        campaign_id,
                        message=message,
                    )
                    continue

                # Dispatch to appropriate handler
                async with async_session_maker() as db:
                    try:
                        await registry.dispatch(
                            message,
                            websocket,
                            campaign_id,
                            user_id,
                            role,
                            db
                        )
                    except Exception as handler_error:
                        print(f"[WebSocket] Handler error for {message_type}: {handler_error}")
                        await manager.send_personal_message({
                            "type": "error",
                            "data": {"message": f"Error handling {message_type}: {str(handler_error)}"},
                        }, websocket)

            except WebSocketDisconnect:
                break
            except RuntimeError as e:
                # Connection already closed, exit silently
                if "WebSocket is not connected" in str(e) or "close message" in str(e):
                    break
                print(f"[WebSocket] Runtime error in message loop: {e}")
                break
            except Exception as e:
                error_msg = str(e)
                # Check if this is a connection-related error
                if "WebSocket" in error_msg or "close" in error_msg.lower():
                    break  # Connection is dead, exit loop silently
                print(f"[WebSocket] Error in message loop: {e}")
                # Don't try to send error message if connection is broken
                try:
                    await manager.send_personal_message({
                        "type": "error",
                        "data": {"message": f"Server error: {error_msg}"},
                    }, websocket)
                except Exception:
                    break  # Connection is dead, exit loop

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket] Connection error: {e}")
    finally:
        # Cancel heartbeat task
        if 'heartbeat_task' in locals():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

        # Disconnect first
        manager.disconnect(websocket)

        # Cleanup any active trades for this user
        try:
            from app.services.websocket_handlers.trade_handler import cleanup_user_trades
            await cleanup_user_trades(campaign_id, user_id)
        except Exception:
            pass

        # Try to notify others, but don't fail if broadcast fails
        try:
            await realtime_publisher.publish_user_presence(
                campaign_id,
                event_type="user_disconnected",
                user_id=user_id,
                role=role,
            )
        except Exception:
            pass  # Silently ignore broadcast errors on disconnect

        print(f"[WebSocket] User {user_id} disconnected from campaign {campaign_id}")


@router.get("/ws/health")
async def websocket_health():
    """WebSocket service health check"""
    return {
        "status": "healthy",
        "active_connections": manager.get_active_connections_count(),
        "registered_handlers": len(registry._handlers)
    }
