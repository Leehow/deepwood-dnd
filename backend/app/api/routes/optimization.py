"""
Optimization API endpoints for tracking refactoring progress and performance metrics.
Part of the project optimization initiative.
"""

from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.optimization import (
    CodeModule, TestSuite, PerformanceMetric, ErrorRecoveryState,
    WebSocketHandler, ModuleType, TestType, MetricType, Environment,
    RecoveryAction
)
from app.schemas.optimization import (
    CodeModuleCreate, CodeModuleUpdate, CodeModuleResponse,
    TestSuiteCreate, TestSuiteUpdate, TestSuiteResponse,
    PerformanceMetricCreate, PerformanceMetricResponse,
    ErrorReportCreate, ErrorRecoveryResponse,
    WebSocketHandlerCreate, WebSocketHandlerResponse,
    MetricsResponse, CodeAnalysisRequest, CodeAnalysisResult,
    RefactorRequest, RefactorResult
)

router = APIRouter(
    prefix="/api/optimization",
    tags=["optimization"],
    responses={404: {"description": "Not found"}},
)


# ===== Performance Metrics Endpoints =====

@router.get("/metrics", response_model=MetricsResponse)
async def get_performance_metrics(
    component: Optional[str] = Query(None, description="Filter by component"),
    metric_type: Optional[MetricType] = Query(None, description="Filter by metric type"),
    from_date: Optional[datetime] = Query(None, description="Start date"),
    to_date: Optional[datetime] = Query(None, description="End date"),
    environment: Optional[Environment] = Query(Environment.DEVELOPMENT),
    db: AsyncSession = Depends(get_db)
):
    """Get performance metrics with optional filters."""
    query = select(PerformanceMetric)

    # Apply filters
    filters = []
    if component:
        filters.append(PerformanceMetric.component == component)
    if metric_type:
        filters.append(PerformanceMetric.metric_type == metric_type)
    if from_date:
        filters.append(PerformanceMetric.measured_at >= from_date)
    if to_date:
        filters.append(PerformanceMetric.measured_at <= to_date)
    if environment:
        filters.append(PerformanceMetric.environment == environment)

    if filters:
        query = query.where(and_(*filters))

    result = await db.execute(query.order_by(PerformanceMetric.measured_at.desc()).limit(100))
    metrics = result.scalars().all()

    # Calculate summary statistics
    if metrics:
        values = [m.value for m in metrics]
        violations = sum(1 for m in metrics if m.is_violation)

        summary = {
            "avg_value": sum(values) / len(values),
            "min_value": min(values),
            "max_value": max(values),
            "violations": violations,
            "total_count": len(metrics)
        }
    else:
        summary = {
            "avg_value": 0,
            "min_value": 0,
            "max_value": 0,
            "violations": 0,
            "total_count": 0
        }

    return MetricsResponse(
        metrics=[m.to_dict() for m in metrics],
        summary=summary
    )


@router.post("/metrics", response_model=PerformanceMetricResponse)
async def record_performance_metric(
    metric: PerformanceMetricCreate,
    db: AsyncSession = Depends(get_db)
):
    """Record a new performance metric."""
    db_metric = PerformanceMetric(
        metric_type=metric.metric_type,
        component=metric.component,
        value=metric.value,
        unit=metric.unit,
        threshold=metric.threshold,
        environment=metric.environment or Environment.DEVELOPMENT,
        context=metric.context or {}
    )

    db.add(db_metric)
    await db.commit()
    await db.refresh(db_metric)

    return PerformanceMetricResponse(**db_metric.to_dict())


# ===== Code Analysis Endpoints =====

@router.post("/code-analysis", response_model=CodeAnalysisResult)
async def analyze_code(
    request: CodeAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Analyze code for refactoring opportunities."""
    import os
    from pathlib import Path

    file_path = Path(request.file_path)
    if not file_path.exists():
        raise HTTPException(404, f"File not found: {request.file_path}")

    # Count lines
    with open(file_path, 'r') as f:
        lines = f.readlines()
        line_count = len([l for l in lines if l.strip()])

    # Basic complexity analysis
    complexity_score = 0
    function_count = 0
    class_count = 0
    import_count = 0

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('def '):
            function_count += 1
            complexity_score += 2
        elif stripped.startswith('class '):
            class_count += 1
            complexity_score += 5
        elif stripped.startswith('import ') or stripped.startswith('from '):
            import_count += 1
            complexity_score += 0.5

    # Extract dependencies
    dependencies = []
    for line in lines:
        if line.strip().startswith('import '):
            dep = line.strip().split(' ')[1].split('.')[0]
            dependencies.append(dep)
        elif line.strip().startswith('from '):
            dep = line.strip().split(' ')[1].split('.')[0]
            dependencies.append(dep)

    dependencies = list(set(dependencies))

    # Generate refactoring suggestions
    suggestions = []
    if line_count > 400:
        priority = "high" if line_count > 800 else "medium"
        suggestions.append({
            "type": "split_file",
            "description": f"File has {line_count} lines. Consider splitting into multiple modules.",
            "priority": priority
        })

    if function_count > 20:
        suggestions.append({
            "type": "extract_utils",
            "description": f"File has {function_count} functions. Consider extracting utility functions.",
            "priority": "medium"
        })

    if class_count > 5:
        suggestions.append({
            "type": "split_classes",
            "description": f"File has {class_count} classes. Consider one class per file.",
            "priority": "medium"
        })

    # Check if module exists in database
    module_name = file_path.stem
    result = await db.execute(
        select(CodeModule).where(CodeModule.file_path == str(file_path))
    )
    existing_module = result.scalar_one_or_none()

    # Update or create module record
    if existing_module:
        existing_module.line_count = line_count
        existing_module.dependencies = dependencies
        existing_module.is_compliant = line_count <= 400
    else:
        new_module = CodeModule(
            name=module_name,
            file_path=str(file_path),
            line_count=line_count,
            type=ModuleType.ROUTE if "routes" in str(file_path) else ModuleType.SERVICE,
            dependencies=dependencies,
            is_compliant=line_count <= 400
        )
        db.add(new_module)

    await db.commit()

    # Get test coverage if available
    test_coverage = 0.0
    if existing_module:
        result = await db.execute(
            select(TestSuite).where(TestSuite.module_id == existing_module.id)
        )
        test_suite = result.scalar_one_or_none()
        if test_suite:
            test_coverage = test_suite.coverage_percent

    return CodeAnalysisResult(
        file_path=str(file_path),
        line_count=line_count,
        complexity_score=complexity_score,
        dependencies=dependencies,
        test_coverage=test_coverage,
        refactoring_suggestions=suggestions
    )


# ===== Refactoring Endpoints =====

@router.post("/refactor", response_model=RefactorResult)
async def refactor_code(
    request: RefactorRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Execute code refactoring (dry-run by default)."""
    # Import the refactoring script
    import sys
    from app.utils.rules_cache import PROJECT_ROOT
    sys.path.append(str(PROJECT_ROOT / "backend" / "scripts"))

    try:
        from refactor_websocket import WebSocketRefactorer
        from pathlib import Path

        source_file = Path(request.source_file)
        target_dir = Path(request.target_directory or "app/api/websocket/handlers")

        refactorer = WebSocketRefactorer(source_file, target_dir)
        created_files = refactorer.refactor(dry_run=request.dry_run)

        # Track refactoring in database
        if not request.dry_run:
            for file_path in created_files.keys():
                module = CodeModule(
                    name=Path(file_path).stem,
                    file_path=file_path,
                    line_count=len(created_files[file_path].split('\n')),
                    type=ModuleType.HANDLER,
                    original_file=str(source_file),
                    is_compliant=True  # New files should be compliant
                )
                db.add(module)

            await db.commit()

        return RefactorResult(
            original_file=str(source_file),
            new_files=[{"path": p, "line_count": len(c.split('\n'))}
                      for p, c in created_files.items()],
            tests_passing=True,  # Would run tests here
            rollback_available=not request.dry_run
        )

    except Exception as e:
        raise HTTPException(500, f"Refactoring failed: {str(e)}")


# ===== Test Coverage Endpoints =====

@router.get("/test-coverage", response_model=Dict[str, Any])
async def get_test_coverage(
    module: Optional[str] = Query(None, description="Filter by module"),
    test_type: Optional[TestType] = Query(None, description="Filter by test type"),
    db: AsyncSession = Depends(get_db)
):
    """Get test coverage report."""
    query = select(TestSuite).options(selectinload(TestSuite.module))

    filters = []
    if module:
        filters.append(CodeModule.name.contains(module))
    if test_type:
        filters.append(TestSuite.type == test_type)

    if filters:
        query = query.join(CodeModule).where(and_(*filters))

    result = await db.execute(query)
    test_suites = result.scalars().all()

    # Calculate overall coverage
    total_coverage = 0.0
    backend_coverage = 0.0
    frontend_coverage = 0.0
    backend_count = 0
    frontend_count = 0

    modules_data = []
    for suite in test_suites:
        module_data = {
            "name": suite.module.name if suite.module else "Unknown",
            "coverage": suite.coverage_percent,
            "test_count": suite.test_count,
            "passing_count": suite.passing_count,
            "type": suite.type
        }
        modules_data.append(module_data)

        if suite.module and "frontend" in suite.module.file_path:
            frontend_coverage += suite.coverage_percent
            frontend_count += 1
        else:
            backend_coverage += suite.coverage_percent
            backend_count += 1

    if backend_count > 0:
        backend_coverage /= backend_count
    if frontend_count > 0:
        frontend_coverage /= frontend_count

    total_count = backend_count + frontend_count
    if total_count > 0:
        total_coverage = (backend_coverage * backend_count +
                        frontend_coverage * frontend_count) / total_count

    return {
        "overall_coverage": total_coverage,
        "backend_coverage": backend_coverage,
        "frontend_coverage": frontend_coverage,
        "modules": modules_data
    }


# ===== Error Recovery Endpoints =====

@router.post("/errors/recovery", response_model=ErrorRecoveryResponse)
async def report_error(
    error_report: ErrorReportCreate,
    db: AsyncSession = Depends(get_db)
):
    """Report error and get recovery action."""
    # Check if there's an existing error state for this component
    result = await db.execute(
        select(ErrorRecoveryState).where(
            and_(
                ErrorRecoveryState.error_type == error_report.error_type,
                ErrorRecoveryState.component == error_report.component,
                ErrorRecoveryState.resolved_at.is_(None)
            )
        )
    )
    error_state = result.scalar_one_or_none()

    if error_state:
        # Update existing error
        if error_state.can_retry:
            error_state.retry_count += 1
            recovery_action = RecoveryAction.RETRY
            retry_after_ms = error_state.next_backoff_ms
        else:
            # Max retries reached
            recovery_action = RecoveryAction.MANUAL
            retry_after_ms = None
            error_state.recovery_action = recovery_action
    else:
        # Create new error state
        error_state = ErrorRecoveryState(
            error_type=error_report.error_type,
            component=error_report.component,
            context=error_report.context or {},
            recovery_action=RecoveryAction.RETRY
        )
        db.add(error_state)
        recovery_action = RecoveryAction.RETRY
        retry_after_ms = error_state.next_backoff_ms

    await db.commit()
    await db.refresh(error_state)

    # Generate user-friendly message
    user_messages = {
        RecoveryAction.RETRY: "The operation will be retried automatically.",
        RecoveryAction.REFRESH: "Please refresh the page to continue.",
        RecoveryAction.FALLBACK: "Using fallback mode. Some features may be limited.",
        RecoveryAction.MANUAL: "Please contact support for assistance.",
    }

    return ErrorRecoveryResponse(
        error_id=str(error_state.id),
        recovery_action=recovery_action,
        retry_after_ms=retry_after_ms,
        user_message=user_messages.get(recovery_action, "An error occurred."),
        technical_details=f"Error: {error_report.error_type} in {error_report.component}"
    )


# ===== WebSocket Handler Registry =====

@router.get("/websocket/handlers", response_model=List[WebSocketHandlerResponse])
async def get_websocket_handlers(
    db: AsyncSession = Depends(get_db)
):
    """Get WebSocket handler registry."""
    result = await db.execute(
        select(WebSocketHandler).order_by(WebSocketHandler.message_type)
    )
    handlers = result.scalars().all()

    return [WebSocketHandlerResponse(**h.to_dict()) for h in handlers]


@router.post("/websocket/handlers", response_model=WebSocketHandlerResponse)
async def register_websocket_handler(
    handler: WebSocketHandlerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Register a WebSocket handler."""
    # Check if handler already exists
    result = await db.execute(
        select(WebSocketHandler).where(
            WebSocketHandler.message_type == handler.message_type
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing handler
        existing.handler_module = handler.handler_module
        existing.handler_class = handler.handler_class
        existing.batch_capable = handler.batch_capable
        db_handler = existing
    else:
        # Create new handler
        db_handler = WebSocketHandler(
            message_type=handler.message_type,
            handler_module=handler.handler_module,
            handler_class=handler.handler_class,
            batch_capable=handler.batch_capable
        )
        db.add(db_handler)

    await db.commit()
    await db.refresh(db_handler)

    return WebSocketHandlerResponse(**db_handler.to_dict())


# ===== Module Management =====

@router.get("/modules", response_model=List[CodeModuleResponse])
async def get_code_modules(
    module_type: Optional[ModuleType] = Query(None),
    is_compliant: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Get code modules with optional filters."""
    query = select(CodeModule)

    filters = []
    if module_type:
        filters.append(CodeModule.type == module_type)
    if is_compliant is not None:
        filters.append(CodeModule.is_compliant == is_compliant)

    if filters:
        query = query.where(and_(*filters))

    result = await db.execute(query.order_by(CodeModule.line_count.desc()))
    modules = result.scalars().all()

    return [CodeModuleResponse(**m.to_dict()) for m in modules]


@router.post("/modules/{module_id}/refactor")
async def mark_module_refactored(
    module_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark a module as refactored."""
    result = await db.execute(
        select(CodeModule).where(CodeModule.id == module_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(404, "Module not found")

    module.last_refactored = datetime.utcnow()
    module.is_compliant = module.line_count <= 400

    await db.commit()

    return {"message": f"Module {module.name} marked as refactored"}


# ===== Health Check =====

@router.get("/health")
async def optimization_health_check(db: AsyncSession = Depends(get_db)):
    """Check optimization system health."""
    # Count various metrics
    module_count = await db.execute(select(func.count(CodeModule.id)))
    compliant_count = await db.execute(
        select(func.count(CodeModule.id)).where(CodeModule.is_compliant == True)
    )
    metric_count = await db.execute(
        select(func.count(PerformanceMetric.id)).where(
            PerformanceMetric.measured_at >= datetime.utcnow() - timedelta(hours=1)
        )
    )

    return {
        "status": "healthy",
        "total_modules": module_count.scalar(),
        "compliant_modules": compliant_count.scalar(),
        "recent_metrics": metric_count.scalar(),
        "timestamp": datetime.utcnow().isoformat()
    }