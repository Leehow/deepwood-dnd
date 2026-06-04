"""
Optimization tracking models for project refactoring.
Part of the project optimization initiative.
"""

from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import uuid4

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, Boolean,
    Text, JSON, ForeignKey, Enum as SQLEnum, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class ModuleType(str, Enum):
    """Types of code modules."""
    HANDLER = "handler"
    SERVICE = "service"
    COMPONENT = "component"
    ROUTE = "route"
    UTILITY = "utility"
    MODEL = "model"
    TEST = "test"


class TestType(str, Enum):
    """Types of tests."""
    UNIT = "unit"
    INTEGRATION = "integration"
    E2E = "e2e"


class MetricType(str, Enum):
    """Types of performance metrics."""
    FPS = "fps"
    LATENCY = "latency"
    QUERY_COUNT = "query_count"
    RESPONSE_TIME = "response_time"
    MEMORY_USAGE = "memory_usage"
    CPU_USAGE = "cpu_usage"


class Environment(str, Enum):
    """Deployment environments."""
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class RecoveryAction(str, Enum):
    """Error recovery actions."""
    RETRY = "retry"
    REFRESH = "refresh"
    FALLBACK = "fallback"
    MANUAL = "manual"
    IGNORE = "ignore"


class CodeModule(Base):
    """Track code modules for refactoring."""

    __tablename__ = "code_modules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False, unique=True)
    file_path = Column(String(500), nullable=False)
    line_count = Column(Integer, nullable=False)
    type = Column(SQLEnum(ModuleType), nullable=False)
    dependencies = Column(JSON, default=list)  # List of module names
    last_refactored = Column(DateTime, default=datetime.utcnow)
    original_file = Column(String(500))
    is_compliant = Column(Boolean, default=False)  # True if <= 400 lines

    # Relationships
    test_suites = relationship("TestSuite", back_populates="module", cascade="all, delete-orphan")
    metrics = relationship("PerformanceMetric", back_populates="module", cascade="all, delete-orphan")

    # Indexes for performance
    __table_args__ = (
        Index('ix_code_modules_type', 'type'),
        Index('ix_code_modules_is_compliant', 'is_compliant'),
        Index('ix_code_modules_line_count', 'line_count'),
    )

    def __repr__(self):
        return f"<CodeModule {self.name}: {self.line_count} lines>"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "name": self.name,
            "file_path": self.file_path,
            "line_count": self.line_count,
            "type": self.type,
            "dependencies": self.dependencies,
            "last_refactored": self.last_refactored.isoformat() if self.last_refactored else None,
            "original_file": self.original_file,
            "is_compliant": self.is_compliant
        }


class TestSuite(Base):
    """Track test coverage for modules."""

    __tablename__ = "test_suites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    module_id = Column(UUID(as_uuid=True), ForeignKey("code_modules.id"), nullable=True)
    type = Column(SQLEnum(TestType), nullable=False)
    coverage_percent = Column(Float, default=0.0)
    test_count = Column(Integer, default=0)
    passing_count = Column(Integer, default=0)
    file_path = Column(String(500), nullable=False)
    last_run = Column(DateTime)
    execution_time_ms = Column(Integer)

    # Relationships
    module = relationship("CodeModule", back_populates="test_suites")

    # Indexes
    __table_args__ = (
        Index('ix_test_suites_type', 'type'),
        Index('ix_test_suites_coverage', 'coverage_percent'),
    )

    def __repr__(self):
        return f"<TestSuite {self.type}: {self.coverage_percent}% coverage>"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "module_id": str(self.module_id) if self.module_id else None,
            "type": self.type,
            "coverage_percent": self.coverage_percent,
            "test_count": self.test_count,
            "passing_count": self.passing_count,
            "file_path": self.file_path,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "execution_time_ms": self.execution_time_ms
        }


class PerformanceMetric(Base):
    """Track performance metrics."""

    __tablename__ = "performance_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    metric_type = Column(SQLEnum(MetricType), nullable=False)
    component = Column(String(255), nullable=False)  # Component being measured
    value = Column(Float, nullable=False)
    unit = Column(String(50), nullable=False)  # fps, ms, count, etc.
    threshold = Column(Float)  # Acceptable threshold
    measured_at = Column(DateTime, default=datetime.utcnow)
    environment = Column(SQLEnum(Environment), default=Environment.DEVELOPMENT)
    context = Column(JSON, default=dict)  # Additional context
    module_id = Column(UUID(as_uuid=True), ForeignKey("code_modules.id"), nullable=True)

    # Relationships
    module = relationship("CodeModule", back_populates="metrics")

    # Indexes
    __table_args__ = (
        Index('ix_performance_metrics_type', 'metric_type'),
        Index('ix_performance_metrics_component', 'component'),
        Index('ix_performance_metrics_measured_at', 'measured_at'),
        Index('ix_performance_metrics_environment', 'environment'),
    )

    @property
    def is_violation(self) -> bool:
        """Check if metric violates threshold."""
        if not self.threshold:
            return False

        # For FPS, higher is better
        if self.metric_type == MetricType.FPS:
            return self.value < self.threshold

        # For other metrics, lower is better
        return self.value > self.threshold

    def __repr__(self):
        return f"<PerformanceMetric {self.metric_type}: {self.value}{self.unit}>"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "metric_type": self.metric_type,
            "component": self.component,
            "value": self.value,
            "unit": self.unit,
            "threshold": self.threshold,
            "measured_at": self.measured_at.isoformat() if self.measured_at else None,
            "environment": self.environment,
            "context": self.context,
            "module_id": str(self.module_id) if self.module_id else None,
            "is_violation": self.is_violation
        }


class ErrorRecoveryState(Base):
    """Track error recovery and retry state."""

    __tablename__ = "error_recovery_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    error_type = Column(String(255), nullable=False)
    component = Column(String(255), nullable=False)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    backoff_ms = Column(Integer, default=100)
    recovery_action = Column(SQLEnum(RecoveryAction), default=RecoveryAction.RETRY)
    context = Column(JSON, default=dict)  # Error context and stack trace
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    # Indexes
    __table_args__ = (
        Index('ix_error_recovery_error_type', 'error_type'),
        Index('ix_error_recovery_component', 'component'),
        Index('ix_error_recovery_created_at', 'created_at'),
        Index('ix_error_recovery_resolved', 'resolved_at'),
    )

    @property
    def can_retry(self) -> bool:
        """Check if can retry."""
        return self.retry_count < self.max_retries and not self.resolved_at

    @property
    def next_backoff_ms(self) -> int:
        """Calculate next backoff delay using exponential backoff with jitter."""
        import random
        base_delay = (2 ** self.retry_count) * self.backoff_ms
        jitter = random.randint(0, 100)
        return base_delay + jitter

    def __repr__(self):
        status = "resolved" if self.resolved_at else f"retry {self.retry_count}/{self.max_retries}"
        return f"<ErrorRecoveryState {self.error_type}: {status}>"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "error_type": self.error_type,
            "component": self.component,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "backoff_ms": self.backoff_ms,
            "recovery_action": self.recovery_action,
            "context": self.context,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "can_retry": self.can_retry,
            "next_backoff_ms": self.next_backoff_ms if self.can_retry else None
        }


class WebSocketHandler(Base):
    """Registry for WebSocket message handlers."""

    __tablename__ = "websocket_handlers"

    message_type = Column(String(100), primary_key=True)
    handler_module = Column(String(255), nullable=False)
    handler_class = Column(String(100), nullable=False)
    avg_processing_ms = Column(Float, default=0.0)
    message_count = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    last_used = Column(DateTime)
    batch_capable = Column(Boolean, default=False)

    # Indexes
    __table_args__ = (
        Index('ix_websocket_handlers_last_used', 'last_used'),
        Index('ix_websocket_handlers_avg_processing', 'avg_processing_ms'),
    )

    @property
    def error_rate(self) -> float:
        """Calculate error rate."""
        if self.message_count == 0:
            return 0.0
        return (self.error_count / self.message_count) * 100

    def update_stats(self, processing_ms: float, had_error: bool = False):
        """Update handler statistics."""
        # Update moving average
        if self.message_count == 0:
            self.avg_processing_ms = processing_ms
        else:
            # Exponential moving average
            alpha = 0.1  # Smoothing factor
            self.avg_processing_ms = (alpha * processing_ms +
                                     (1 - alpha) * self.avg_processing_ms)

        self.message_count += 1
        if had_error:
            self.error_count += 1
        self.last_used = datetime.utcnow()

    def __repr__(self):
        return f"<WebSocketHandler {self.message_type}: {self.avg_processing_ms:.2f}ms>"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "message_type": self.message_type,
            "handler_module": self.handler_module,
            "handler_class": self.handler_class,
            "avg_processing_ms": self.avg_processing_ms,
            "message_count": self.message_count,
            "error_count": self.error_count,
            "error_rate": self.error_rate,
            "last_used": self.last_used.isoformat() if self.last_used else None,
            "batch_capable": self.batch_capable
        }