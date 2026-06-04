"""ParsedModule model - 已解析的模组元数据和内容"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class ParsedModule(Base):
    """已解析模组的元数据和内容表"""
    __tablename__ = "parsed_modules"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(String(100), unique=True, nullable=False, index=True)  # UUID格式
    title = Column(String(500), nullable=False)
    title_en = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)

    # 统计信息
    chapters_count = Column(Integer, default=0)
    monsters_count = Column(Integer, default=0)
    items_count = Column(Integer, default=0)
    images_count = Column(Integer, default=0)
    tables_count = Column(Integer, default=0)

    # 解析内容 (JSONB)
    module_info = Column(JSONB, nullable=True)      # 模组基本信息
    chapters = Column(JSONB, nullable=True)         # 章节树 (chapter_tree)
    monsters = Column(JSONB, nullable=True)         # 怪物列表
    items = Column(JSONB, nullable=True)            # 物品列表
    images = Column(JSONB, nullable=True)           # 图片及分类
    tables = Column(JSONB, nullable=True)           # 表格列表
    toc = Column(JSONB, nullable=True)              # 目录结构

    # 关联信息
    source_file_id = Column(String(100), nullable=True)  # raw_module_files.id
    data_file = Column(String(500), nullable=True)  # 兼容旧JSON文件路径

    # 权限控制
    created_by = Column(String(100), nullable=False, index=True)
    is_shared = Column(Boolean, default=False, index=True)
    original_module_id = Column(String(100), nullable=True)  # 复制来源

    # 时间戳
    parsed_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
