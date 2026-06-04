from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
from datetime import datetime

from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.db.session import get_db
from app.models.chat_message import ChatMessage
from app.schemas.chat import ChatMessageCreate, ChatMessageResponse, ChatMessageUpdate
from app.services.realtime_publisher import realtime_publisher

router = APIRouter(prefix="/campaigns", tags=["Chat"])


@router.get("/{campaign_id}/chat/messages", response_model=List[ChatMessageResponse])
async def list_chat_messages(
    campaign_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: Optional[int] = Query(None, description="Fetch messages with id < before_id for pagination"),
    message_type: Optional[str] = Query(None, description="Filter by message_type (e.g., 'dice')"),
    sender_role: Optional[str] = Query(None, description="Filter by sender_role (e.g., 'ai')"),
    filter_user_id: Optional[str] = Query(None, description="Bidirectional user filter: sender_user_id=X OR recipients contains X"),
    ai_conversation: Optional[bool] = Query(None, description="AI conversation filter: sender_role='ai' OR recipients contains 'ai'"),
    ai_session_id: Optional[int] = Query(None, description="Filter by AI session ID"),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List recent chat messages for a campaign (newest first).

    Returns:
    - Public messages (is_private=False)
    - Private messages where user is sender or recipient
    - DM can see all messages
    """
    from sqlalchemy import or_, and_, cast, String
    from sqlalchemy.dialects.postgresql import JSONB
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    role = context.role

    stmt = select(ChatMessage).where(ChatMessage.campaign_id == campaign_id)

    # Filter by message_type if specified
    if message_type:
        stmt = stmt.where(ChatMessage.message_type == message_type)

    # Filter by sender_role if specified
    if sender_role:
        stmt = stmt.where(ChatMessage.sender_role == sender_role)

    # Bidirectional user filter: messages from/to a specific user
    if filter_user_id:
        stmt = stmt.where(
            or_(
                ChatMessage.sender_user_id == filter_user_id,
                cast(ChatMessage.recipients, JSONB).op('@>')(cast([filter_user_id], JSONB))
            )
        )

    # AI conversation filter: messages from AI or addressed to AI
    if ai_conversation:
        stmt = stmt.where(
            or_(
                ChatMessage.sender_role == 'ai',
                cast(ChatMessage.recipients, JSONB).op('@>')(cast(['ai'], JSONB))
            )
        )

    # AI session filter
    if ai_session_id is not None:
        stmt = stmt.where(ChatMessage.ai_session_id == ai_session_id)

    # Filter private messages: DM sees all, others see only their own
    if role != "dm":
        stmt = stmt.where(
            or_(
                ChatMessage.is_private == False,
                ChatMessage.sender_user_id == user_id,
                cast(ChatMessage.recipients, JSONB).op('@>')(cast([user_id], JSONB))
            )
        )

    if before_id is not None:
        stmt = stmt.where(ChatMessage.id < before_id)
    stmt = stmt.order_by(ChatMessage.id.desc()).limit(limit)

    res = await db.execute(stmt)
    rows = res.scalars().all()

    # Strip tts_audio from meta to avoid response bloat (~300KB per message).
    # Keep tts_format so frontend knows cache exists in DB.
    for row in rows:
        if row.meta and "tts_audio" in row.meta:
            meta = dict(row.meta)
            meta.pop("tts_audio", None)
            row.meta = meta

    return rows


@router.post("/{campaign_id}/chat/messages", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
async def create_chat_message(
    campaign_id: int,
    body: ChatMessageCreate,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create a chat message via HTTP (alternative to WebSocket)."""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    role = context.role
    msg = ChatMessage(
        campaign_id=campaign_id,
        sender_user_id=user_id,
        sender_role=role,
        sender_character_id=None,
        message_type=body.message_type or "chat",
        content=body.content,
        recipients=body.recipients or [],
        is_private=len(body.recipients or []) > 0,
        mentions=[],
        meta=body.meta or {},
        reply_to_id=body.reply_to_id,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Broadcast via WebSocket so all connected clients see it in real-time
    if body.message_type == "system" and body.meta and body.meta.get("consumable_use"):
        await realtime_publisher.publish_consumable_use(
            campaign_id,
            data={
                "id": msg.id,
                "user_id": user_id,
                "character_name": body.meta["consumable_use"].get("character_name", ""),
                "item_name": body.meta["consumable_use"].get("item_name", ""),
                "result_text": body.content,
                "dice_rolls": body.meta["consumable_use"].get("dice_rolls"),
                "dice_bonus": body.meta["consumable_use"].get("dice_bonus"),
                "dice_total": body.meta["consumable_use"].get("dice_total"),
                "healing": body.meta["consumable_use"].get("healing"),
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            },
        )

    return msg


@router.post("/{campaign_id}/chat/messages/{message_id}", response_model=ChatMessageResponse)
async def update_chat_message(
    campaign_id: int,
    message_id: int,
    body: ChatMessageUpdate,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone, timedelta
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    role = context.role

    msg = await db.get(ChatMessage, message_id)
    if not msg or msg.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Message not found")

    # Permission: owner or DM
    if role != "dm" and msg.sender_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to edit this message")

    if msg.is_deleted:
        raise HTTPException(status_code=400, detail="Message already deleted")

    # Time limit: only allow editing within 2 minutes (except for DM)
    if role != "dm":
        now = datetime.now(timezone.utc)
        message_time = msg.created_at
        if message_time.tzinfo is None:
            message_time = message_time.replace(tzinfo=timezone.utc)
        time_diff = now - message_time
        if time_diff > timedelta(minutes=2):
            raise HTTPException(status_code=403, detail="Can only edit messages within 2 minutes")

    msg.content = body.content
    meta = dict(msg.meta or {})
    meta["edited"] = True
    meta["edited_at"] = datetime.utcnow().isoformat()
    msg.meta = meta

    await db.commit()
    await db.refresh(msg)

    # Broadcast edit event (frontends that don't have this message will ignore)
    await realtime_publisher.publish_chat_edit(
        campaign_id,
        message_id=msg.id,
        content=msg.content,
        timestamp=int(datetime.utcnow().timestamp() * 1000),
    )

    return msg


@router.delete("/{campaign_id}/chat/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_message(
    campaign_id: int,
    message_id: int,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone, timedelta
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    role = context.role

    msg = await db.get(ChatMessage, message_id)
    if not msg or msg.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Message not found")

    # Permission: owner or DM
    # AI assistant messages (sender_role='ai', recipient is this player) can be deleted by the player
    is_own_ai_conversation = (
        msg.sender_role == "ai"
        and msg.recipients
        and user_id in msg.recipients
    )
    if role != "dm" and msg.sender_user_id != user_id and not is_own_ai_conversation:
        raise HTTPException(status_code=403, detail="Not allowed to delete this message")

    if msg.is_deleted:
        return  # Idempotent

    # Time limit: only allow deleting within 2 minutes (except for DM and AI assistant messages)
    if role != "dm" and not is_own_ai_conversation:
        now = datetime.now(timezone.utc)
        message_time = msg.created_at
        if message_time.tzinfo is None:
            message_time = message_time.replace(tzinfo=timezone.utc)
        time_diff = now - message_time
        if time_diff > timedelta(minutes=2):
            raise HTTPException(status_code=403, detail="Can only delete messages within 2 minutes")

    msg.is_deleted = True
    msg.deleted_at = datetime.utcnow()

    await db.commit()

    # Broadcast delete event
    await realtime_publisher.publish_chat_delete(
        campaign_id,
        message_id=msg.id,
        timestamp=int(datetime.utcnow().timestamp() * 1000),
    )

    return None



@router.delete("/{campaign_id}/chat/messages", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat_messages(
    campaign_id: int,
    preserve_ai: bool = Query(False, description="Keep AI assistant conversation history"),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Clear all chat messages in a campaign (DM only).

    Hard delete all messages for the campaign, then broadcast chat_clear.
    """
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    role = context.role
    if role != "dm":
        raise HTTPException(status_code=403, detail="Only DM can clear chat")

    delete_stmt = delete(ChatMessage).where(ChatMessage.campaign_id == campaign_id)

    if preserve_ai:
        from sqlalchemy import or_, cast
        from sqlalchemy.dialects.postgresql import JSONB

        ai_conversation_filter = or_(
            ChatMessage.sender_role == "ai",
            cast(ChatMessage.recipients, JSONB).op("@>")(cast(["ai"], JSONB)),
            ChatMessage.ai_session_id.is_not(None),
        )
        delete_stmt = delete_stmt.where(~ai_conversation_filter)

    # Hard delete matching messages for this campaign
    await db.execute(delete_stmt)
    await db.commit()

    # Broadcast clear event to all clients in the campaign
    await realtime_publisher.publish_chat_clear(
        campaign_id,
        preserve_ai=preserve_ai,
        timestamp=int(datetime.utcnow().timestamp() * 1000),
    )

    return None


@router.get("/{campaign_id}/chat/search")
async def search_chat_messages(
    campaign_id: int,
    q: str = Query(..., description="Search query"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Search chat messages by content.

    Returns paginated results matching the search query.
    Respects privacy: users can only see public messages and their own private messages.
    """
    from sqlalchemy import or_, and_, cast, func
    from sqlalchemy.dialects.postgresql import JSONB
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    role = context.role

    # Base query with search filter
    stmt = select(ChatMessage).where(
        ChatMessage.campaign_id == campaign_id,
        ChatMessage.is_deleted == False,
        ChatMessage.content.ilike(f"%{q}%")
    )

    # Filter private messages: DM sees all, others see only their own
    if role != "dm":
        stmt = stmt.where(
            or_(
                ChatMessage.is_private == False,
                ChatMessage.sender_user_id == user_id,
                cast(ChatMessage.recipients, JSONB).op('@>')(cast([user_id], JSONB))
            )
        )

    # Count total results
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    stmt = stmt.order_by(ChatMessage.id.desc()).offset(offset).limit(page_size)

    res = await db.execute(stmt)
    rows = res.scalars().all()

    return {
        "messages": [ChatMessageResponse.model_validate(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
    }
