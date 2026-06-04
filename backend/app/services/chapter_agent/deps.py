"""Agent dependency container."""
import asyncio
from dataclasses import dataclass, field
from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import RangeEdit


@dataclass
class AgentDeps:
    """Dependencies injected into every tool via RunContext."""
    db: AsyncSession
    module_id: str
    chapter_title: str
    chapter_content: str
    user_id: str
    pending_edits: list[RangeEdit] = field(default_factory=list)
    tool_event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
