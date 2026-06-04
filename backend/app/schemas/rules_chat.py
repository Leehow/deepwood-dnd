"""Pydantic schemas for Rules Chat API"""
from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime
from typing import List, Optional


class RulesChatMessageCreate(BaseModel):
    """Request schema for creating a chat message"""
    content: str = Field(..., min_length=1, description="User question")


class RulesChatMessageResponse(BaseModel):
    """Response schema for chat messages"""
    id: int
    campaign_id: int
    user_id: str
    role: str  # 'user' | 'assistant'
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RulesChatHistoryResponse(BaseModel):
    """Response schema for chat history list"""
    messages: List[RulesChatMessageResponse]
    total: int


class RulesChatQueryRequest(BaseModel):
    """Request schema for AI query"""
    question: str = Field(..., min_length=1, description="Question about D&D rules")


class RulesChatQueryResponse(BaseModel):
    """Response schema for AI query (non-streaming)"""
    question: str
    answer: str
    sources: List[str] = []  # Relevant rule sources used


class RulesSearchResult(BaseModel):
    """Search result from vector similarity search"""
    content: str
    source: str
    page_number: Optional[int]
    similarity: float
