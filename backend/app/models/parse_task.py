"""
Parse task model for background parsing
"""
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class ParseTask(Base):
    """解析任务模型"""
    __tablename__ = "parse_tasks"
    
    id = Column(String, primary_key=True)  # Task ID (UUID)
    file_id = Column(String, nullable=False, index=True)  # Source file ID
    status = Column(String, nullable=False, default="pending")  # pending, running, completed, failed
    progress = Column(Integer, default=0)  # 0-100
    current_step = Column(String, default="")  # Current step name
    current_message = Column(String, default="")  # Current progress message
    
    # Detailed progress tracking
    steps_completed = Column(JSON, default=list)  # List of completed steps
    batch_messages = Column(JSON, default=list)  # Recent batch messages (last 20)
    
    # Result
    module_id = Column(String, nullable=True)  # Parsed module ID (when completed)
    error_message = Column(Text, nullable=True)  # Error message (when failed)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            "id": self.id,
            "file_id": self.file_id,
            "status": self.status,
            "progress": self.progress,
            "current_step": self.current_step,
            "current_message": self.current_message,
            "steps_completed": self.steps_completed or [],
            "batch_messages": self.batch_messages or [],
            "module_id": self.module_id,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

