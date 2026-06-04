"""Chat history persistence for the chapter agent."""
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
    TextPart,
)

from app.models.module_chat import ModuleChatMessage

logger = logging.getLogger(__name__)


async def load_history(
    db: AsyncSession,
    module_id: str,
    user_id: str,
    chapter_title: str,
    limit: int = 20,
) -> list[ModelMessage]:
    """Load recent chat history from DB and convert to Pydantic AI messages."""
    result = await db.execute(
        select(ModuleChatMessage)
        .where(
            ModuleChatMessage.module_id == module_id,
            ModuleChatMessage.user_id == user_id,
            ModuleChatMessage.chapter_title == chapter_title,
        )
        .order_by(ModuleChatMessage.created_at.desc())
        .limit(limit)
    )
    rows = list(reversed(result.scalars().all()))

    messages: list[ModelMessage] = []
    for row in rows:
        if row.role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=row.content)]))
        elif row.role == "assistant":
            messages.append(ModelResponse(parts=[TextPart(content=row.content)]))
    return messages


async def save_message(
    db: AsyncSession,
    module_id: str,
    user_id: str,
    role: str,
    content: str,
    chapter_title: Optional[str] = None,
    tool_calls: Optional[list] = None,
) -> int:
    """Persist a single message and return its id."""
    msg = ModuleChatMessage(
        module_id=module_id,
        user_id=user_id,
        role=role,
        content=content,
        chapter_title=chapter_title or None,
        tool_calls=tool_calls,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg.id
