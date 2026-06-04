"""ModuleParseTask model - 模组解析任务"""
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.sql import func
from app.db.session import Base


class ModuleParseTask(Base):
    """模组解析任务表"""
    __tablename__ = "module_parse_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(100), unique=True, nullable=False, index=True)  # UUID格式
    file_id = Column(String(100), nullable=False, index=True)  # raw_module_files.id

    # 状态信息
    status = Column(String(50), default="pending", index=True)  # pending, running, completed, failed
    progress = Column(Integer, default=0)  # 0-100
    current_step = Column(String(100), nullable=True)
    current_message = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    # 批处理消息（JSON数组）
    steps_completed = Column(JSON, default=list)
    batch_messages = Column(JSON, default=list)

    # 结果
    module_id = Column(String(100), nullable=True)  # 解析成功后的模组ID

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
