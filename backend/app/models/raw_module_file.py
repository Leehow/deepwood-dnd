"""
Raw Module File model for storing uploaded files and converted markdown
"""
from datetime import datetime
from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, BigInteger
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db.session import Base


class RawModuleFile(Base):
    """Model for storing raw module files and their converted markdown content"""
    __tablename__ = "raw_module_files"

    id = Column(Integer, primary_key=True, index=True)

    # File info
    title = Column(String(500), nullable=False)
    original_filename = Column(String(500), nullable=False)
    file_type = Column(String(50), nullable=False)  # pdf, markdown, zip
    file_size = Column(BigInteger, nullable=False)

    # Status: uploaded, converting, ocr_complete, converted, parsing, parsed, error
    status = Column(String(50), default="uploaded")
    error_message = Column(Text, nullable=True)

    # Converted markdown content (stored directly in DB)
    markdown_content = Column(Text, nullable=True)
    source_language = Column(String(10), nullable=True)  # zh, en
    is_translated = Column(String(10), default="no")  # yes, no

    # OCR data (JSONB for resumable processing)
    ocr_provider = Column(String(50), nullable=True)  # mineru, mistral, doc2x, local_gs
    headings_inferred = Column(Boolean, default=False)  # bbox+LLM heading inference succeeded
    ocr_images = Column(JSONB, nullable=True)  # [{image_id, image_base64, page_index, context}]
    image_classifications = Column(JSONB, nullable=True)  # [{image_id, category, description, ...}]

    # Ownership
    created_by = Column(String(100), nullable=False)  # user_id

    # Parsed module reference
    parsed_module_id = Column(String(100), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    converted_at = Column(DateTime(timezone=True), nullable=True)
    parsed_at = Column(DateTime(timezone=True), nullable=True)
