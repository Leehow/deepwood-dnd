"""CustomModule model - 用户自定义冒险模组"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class CustomModule(Base):
    """用户自定义冒险模组表"""
    __tablename__ = "custom_modules"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(String(100), unique=True, nullable=False, index=True)  # UUID格式
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    template_id = Column(String(50), nullable=True)  # e.g., "classic_dungeon"

    # JSONB内容字段
    chapters = Column(JSONB, default=list)      # 故事章节/场景
    npcs = Column(JSONB, default=list)          # NPC列表
    locations = Column(JSONB, default=list)     # 地点/场景
    encounters = Column(JSONB, default=list)    # 遭遇战
    treasures = Column(JSONB, default=list)     # 物品/奖励

    # 元数据
    recommended_level_min = Column(Integer, default=1)
    recommended_level_max = Column(Integer, default=5)
    estimated_sessions = Column(String(20), nullable=True)  # e.g., "2-4"

    # 权限控制 (与 ParsedModule 相同模式)
    created_by = Column(String(100), nullable=False, index=True)
    is_shared = Column(Boolean, default=False, index=True)

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
