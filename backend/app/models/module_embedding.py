"""Module Embedding model for vector search using pgvector"""
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
from app.db.session import Base


class ModuleEmbedding(Base):
    """Stores module text chunks with embeddings for RAG search"""
    __tablename__ = "module_embeddings"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(String(100), index=True, nullable=False)  # parsed_module.module_id
    chapter_title = Column(String(500), nullable=True)  # 章节标题
    chapter_path = Column(String(1000), nullable=True)  # 章节路径 "第1章/老旧地道"
    chunk_index = Column(Integer, nullable=False)  # 在该章节内的索引
    content = Column(Text, nullable=False)  # 原文 chunk
    embedding = Column(Vector(1024), nullable=False)  # text-embedding-v4 dimension
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # NOTE: module_id index is created via index=True on the column above.
    # A duplicate explicit Index() with the same name was removed — it made
    # Base.metadata.create_all emit CREATE INDEX twice and broke fresh-DB test setup.
