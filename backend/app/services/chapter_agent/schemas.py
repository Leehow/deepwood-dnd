"""Schemas for the chapter editing agent."""
from pydantic import BaseModel
from typing import Literal, Optional


class RangeEdit(BaseModel):
    """A single line-range edit proposed by the agent."""
    start_line: int   # 1-indexed, inclusive
    end_line: int     # 1-indexed, inclusive
    content: str      # replacement markdown


class AgentSSEEvent(BaseModel):
    """Server-Sent Event payload for the chapter agent stream."""
    type: Literal["text", "edit", "tool_call", "done", "error"]
    content: Optional[str] = None
    edits: Optional[list[RangeEdit]] = None
    message_id: Optional[int] = None
    user_message_id: Optional[int] = None
    tool_name: Optional[str] = None
    tool_args: Optional[str] = None
