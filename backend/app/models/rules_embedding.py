"""Rules Embedding model for vector search using pgvector"""
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
from app.db.session import Base


class RulesEmbedding(Base):
    """Stores text chunks with embeddings for RAG search"""
    __tablename__ = "rules_embeddings"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(100), index=True, nullable=False)  # PDF filename
    page_number = Column(Integer, nullable=True)
    chunk_index = Column(Integer, nullable=False)  # Index within page/source
    content = Column(Text, nullable=False)  # Original text chunk
    embedding = Column(Vector(1024), nullable=False)  # text-embedding-v4 dimension
    created_at = Column(DateTime(timezone=True), server_default=func.now())
