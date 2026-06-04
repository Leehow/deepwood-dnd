"""
Rules Chat API routes for AI-powered D&D rules Q&A
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Optional
import json

from app.db.session import get_db
from app.models.rules_chat import RulesChatMessage
from app.models.campaign import Campaign
from app.models.ai_settings import AIModelConfig
from app.schemas.rules_chat import (
    RulesChatMessageCreate,
    RulesChatMessageResponse,
    RulesChatHistoryResponse,
    RulesSearchResult
)
from app.services.rules_embedding_service import RulesEmbeddingService
from app.services.ai_service import AIService
from app.services.ai_model_service import ai_model_service
from app.core.dependencies import get_locale_context
from app.core.locale import LocaleContext
from app.services.ai_prompts import build_rules_chat_system_prompt

router = APIRouter(prefix="/campaigns/{campaign_id}/rules-chat", tags=["Rules Chat"])


async def get_chat_model(db: AsyncSession) -> AIModelConfig:
    """Get model configuration for rules chat via usage config"""
    return await ai_model_service.get_config_for_usage(db, "rules_chat")


@router.get("", response_model=RulesChatHistoryResponse)
async def get_chat_history(
    campaign_id: int,
    user_id: str = Query(..., description="User ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    """Get chat history for a user in a campaign"""
    # Verify campaign exists
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Query messages
    query = (
        select(RulesChatMessage)
        .where(
            RulesChatMessage.campaign_id == campaign_id,
            RulesChatMessage.user_id == user_id
        )
        .order_by(RulesChatMessage.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    messages = result.scalars().all()

    # Get total count
    count_query = (
        select(RulesChatMessage)
        .where(
            RulesChatMessage.campaign_id == campaign_id,
            RulesChatMessage.user_id == user_id
        )
    )
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())

    return RulesChatHistoryResponse(
        messages=[RulesChatMessageResponse.model_validate(m) for m in messages],
        total=total
    )


@router.post("/query")
async def query_rules(
    campaign_id: int,
    request: RulesChatMessageCreate,
    user_id: str = Query(..., description="User ID"),
    db: AsyncSession = Depends(get_db),
    locale_context: LocaleContext = Depends(get_locale_context),
):
    """
    Query AI about D&D rules with RAG-enhanced context

    Returns streaming SSE response with AI answer
    """
    # Verify campaign exists
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get CHAT model config and params
    usage_params = await ai_model_service.get_usage_params(db, "rules_chat")
    chat_config = usage_params.config
    temperature = usage_params.temperature
    max_tokens = usage_params.max_tokens

    # Save user's question
    user_message = RulesChatMessage(
        campaign_id=campaign_id,
        user_id=user_id,
        role="user",
        content=request.content
    )
    db.add(user_message)
    await db.commit()

    # Search for relevant rules using RAG
    embedding_service = RulesEmbeddingService(db)
    try:
        search_results = await embedding_service.search_similar_rules(
            request.content,
            top_k=5,
            similarity_threshold=0.3
        )
    except Exception as e:
        # If embedding search fails (e.g. pgvector error), rollback the
        # failed transaction so the session is usable for later queries.
        await db.rollback()
        search_results = []

    # Build context from search results — label localized to match the
    # system prompt locale so the model isn't pulled cross-language.
    is_zh = locale_context.locale == "zh-CN"
    source_label = "来源" if is_zh else "Source"
    page_label = "页" if is_zh else "p."
    context_parts = []
    sources = []
    for result in search_results:
        context_parts.append(
            f"[{source_label}: {result['source']}, {page_label}{result['page_number']}]\n{result['content']}"
        )
        source_ref = f"{result['source']} p.{result['page_number']}"
        if source_ref not in sources:
            sources.append(source_ref)

    context = "\n\n".join(context_parts) if context_parts else ""

    system_prompt = build_rules_chat_system_prompt(
        locale_context.locale,
        rules_context=context or None,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": request.content}
    ]

    async def generate_stream():
        """Generate SSE stream for AI response"""
        full_response = ""

        try:
            # Send sources first if any
            if sources:
                yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

            # Stream AI response
            async for chunk in AIService.generate_completion_stream(
                api_url=chat_config.api_url,
                api_key=chat_config.api_key,
                model=chat_config.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            ):
                full_response += chunk
                yield f"data: {json.dumps({'type': 'content', 'content': chunk})}\n\n"

            # Save assistant's response
            assistant_message = RulesChatMessage(
                campaign_id=campaign_id,
                user_id=user_id,
                role="assistant",
                content=full_response
            )
            db.add(assistant_message)
            await db.commit()

            # Send completion signal
            yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_message.id})}\n\n"

        except Exception as e:
            await db.rollback()
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.delete("/{message_id}")
async def delete_chat_message(
    campaign_id: int,
    message_id: int,
    user_id: str = Query(..., description="User ID"),
    db: AsyncSession = Depends(get_db)
):
    """Delete a single chat message"""
    message = await db.get(RulesChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.campaign_id != campaign_id or message.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to delete this message")
    await db.delete(message)
    await db.commit()
    return {"status": "success", "message": "Message deleted"}


@router.delete("")
async def clear_chat_history(
    campaign_id: int,
    user_id: str = Query(..., description="User ID"),
    db: AsyncSession = Depends(get_db)
):
    """Clear all chat history for a user in a campaign"""
    # Verify campaign exists
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Delete messages
    await db.execute(
        delete(RulesChatMessage).where(
            RulesChatMessage.campaign_id == campaign_id,
            RulesChatMessage.user_id == user_id
        )
    )
    await db.commit()

    return {"status": "success", "message": "Chat history cleared"}


@router.get("/search", response_model=list[RulesSearchResult])
async def search_rules(
    campaign_id: int,
    q: str = Query(..., min_length=2, description="Search query"),
    top_k: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db)
):
    """Search rules using vector similarity (for debugging/testing)"""
    embedding_service = RulesEmbeddingService(db)

    try:
        results = await embedding_service.search_similar_rules(q, top_k=top_k)
        return [
            RulesSearchResult(
                content=r["content"],
                source=r["source"],
                page_number=r["page_number"],
                similarity=r["similarity"]
            )
            for r in results
        ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}"
        )
