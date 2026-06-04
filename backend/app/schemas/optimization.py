"""
Pydantic schemas for optimization tracking.
Part of the project optimization initiative.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict

from app.models.optimization import (
    ModuleType, TestType, MetricType, Environment, RecoveryAction
)


# ===== Code Module Schemas =====

class CodeModuleBase(BaseModel):
    """Base schema for code modules."""
    name: str
    file_path: str
    line_count: int
    type: ModuleType
    dependencies: List[str] = []
    original_file: Optional[str] = None
    is_compliant: bool = False


class CodeModuleCreate(CodeModuleBase):
    """Schema for creating a code module."""
    pass


class CodeModuleUpdate(BaseModel):
    """Schema for updating a code module."""
    line_count: Optional[int] = None
    dependencies: Optional[List[str]] = None
    is_compliant: Optional[bool] = None


class CodeModuleResponse(CodeModuleBase):
    """Response schema for code modules."""
    id: UUID
    last_refactored: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ===== Test Suite Schemas =====

class TestSuiteBase(BaseModel):
    """Base schema for test suites."""
    module_id: Optional[UUID] = None
    type: TestType
    coverage_percent: float = 0.0
    test_count: int = 0
    passing_count: int = 0
    file_path: str
    execution_time_ms: Optional[int] = None


class TestSuiteCreate(TestSuiteBase):
    """Schema for creating a test suite."""
    pass


class TestSuiteUpdate(BaseModel):
    """Schema for updating a test suite."""
    coverage_percent: Optional[float] = None
    test_count: Optional[int] = None
    passing_count: Optional[int] = None
    execution_time_ms: Optional[int] = None


class TestSuiteResponse(TestSuiteBase):
    """Response schema for test suites."""
    id: UUID
    last_run: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ===== Performance Metric Schemas =====

class PerformanceMetricCreate(BaseModel):
    """Schema for creating a performance metric."""
    metric_type: MetricType
    component: str
    value: float
    unit: str
    threshold: Optional[float] = None
    environment: Optional[Environment] = Environment.DEVELOPMENT
    context: Optional[Dict[str, Any]] = None
    module_id: Optional[UUID] = None


class PerformanceMetricResponse(BaseModel):
    """Response schema for performance metrics."""
    id: UUID
    metric_type: MetricType
    component: str
    value: float
    unit: str
    threshold: Optional[float] = None
    measured_at: datetime
    environment: Environment
    context: Dict[str, Any]
    module_id: Optional[UUID] = None
    is_violation: bool

    model_config = ConfigDict(from_attributes=True)


class MetricsResponse(BaseModel):
    """Response schema for metrics endpoint."""
    metrics: List[Dict[str, Any]]
    summary: Dict[str, Any] = Field(
        default={
            "avg_value": 0,
            "min_value": 0,
            "max_value": 0,
            "violations": 0,
            "total_count": 0
        }
    )


# ===== Error Recovery Schemas =====

class ErrorReportCreate(BaseModel):
    """Schema for reporting an error."""
    error_type: str
    component: str
    context: Optional[Dict[str, Any]] = None


class ErrorRecoveryResponse(BaseModel):
    """Response schema for error recovery."""
    error_id: str
    recovery_action: RecoveryAction
    retry_after_ms: Optional[int] = None
    user_message: str
    technical_details: str

    model_config = ConfigDict(from_attributes=True)


# ===== WebSocket Handler Schemas =====

class WebSocketHandlerCreate(BaseModel):
    """Schema for creating a WebSocket handler."""
    message_type: str
    handler_module: str
    handler_class: str
    batch_capable: bool = False


class WebSocketHandlerResponse(BaseModel):
    """Response schema for WebSocket handlers."""
    message_type: str
    handler_module: str
    handler_class: str
    avg_processing_ms: float
    message_count: int
    error_count: int
    error_rate: float
    last_used: Optional[datetime] = None
    batch_capable: bool

    model_config = ConfigDict(from_attributes=True)


# ===== Code Analysis Schemas =====

class CodeAnalysisRequest(BaseModel):
    """Request schema for code analysis."""
    file_path: str
    include_dependencies: bool = True
    include_complexity: bool = True
    include_test_coverage: bool = True


class RefactoringPlan(BaseModel):
    """Refactoring suggestion."""
    type: str
    description: str
    priority: str = "medium"  # low, medium, high


class CodeAnalysisResult(BaseModel):
    """Result of code analysis."""
    file_path: str
    line_count: int
    complexity_score: float
    dependencies: List[str]
    test_coverage: float
    refactoring_suggestions: List[Dict[str, Any]]


# ===== Refactoring Schemas =====

class RefactorRequest(BaseModel):
    """Request schema for code refactoring."""
    source_file: str
    target_directory: Optional[str] = None
    dry_run: bool = True
    run_tests: bool = True


class RefactorResult(BaseModel):
    """Result of refactoring operation."""
    original_file: str
    new_files: List[Dict[str, Any]]  # {path: str, line_count: int}
    tests_passing: bool
    rollback_available: bool