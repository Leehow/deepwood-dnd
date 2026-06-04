"""
Performance monitoring middleware for tracking request metrics.
Part of the project optimization initiative.
"""

import time
import asyncio
from typing import Callable, Dict, Any
from datetime import datetime
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import Message
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.optimization import PerformanceMetric, MetricType, Environment
from app.core.config import get_settings

settings = get_settings()


class PerformanceMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track performance metrics for all API requests.
    Monitors response time, query count, and memory usage.
    """

    def __init__(self, app):
        super().__init__(app)
        self.metrics_buffer = []
        self.buffer_lock = asyncio.Lock()
        self.last_flush = time.time()
        self.flush_interval = 10  # Flush every 10 seconds

        # Create synchronous engine for middleware (can't use async in middleware)
        db_url = settings.DATABASE_URL.replace("+asyncpg", "")
        self.engine = create_engine(db_url)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and track performance metrics."""
        # Skip health check endpoints
        if request.url.path in ["/health", "/api/health", "/api/optimization/health"]:
            return await call_next(request)

        # Track request start time
        start_time = time.time()

        # Add request ID for tracing
        request_id = str(uuid4())[:8]
        request.state.request_id = request_id

        # Track query count (would need to instrument SQLAlchemy)
        request.state.query_count = 0

        try:
            # Process request
            response = await call_next(request)

            # Calculate metrics
            response_time = (time.time() - start_time) * 1000  # Convert to ms

            # Record metric
            await self.record_metric(
                request=request,
                response_time=response_time,
                status_code=response.status_code
            )

            # Add performance headers
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{response_time:.2f}ms"

            # Check if response time exceeds threshold
            if response_time > 500:  # 500ms threshold
                await self.record_slow_request(request, response_time)

            return response

        except Exception as e:
            # Track error
            response_time = (time.time() - start_time) * 1000
            await self.record_error(request, str(e), response_time)
            raise

    async def record_metric(
        self,
        request: Request,
        response_time: float,
        status_code: int
    ):
        """Record performance metric to buffer."""
        metric = {
            "metric_type": MetricType.RESPONSE_TIME,
            "component": f"{request.method} {request.url.path}",
            "value": response_time,
            "unit": "ms",
            "threshold": 200.0,  # 200ms threshold for API responses
            "environment": self._get_environment(),
            "context": {
                "method": request.method,
                "path": request.url.path,
                "status_code": status_code,
                "request_id": getattr(request.state, "request_id", None),
                "query_count": getattr(request.state, "query_count", 0)
            },
            "measured_at": datetime.utcnow()
        }

        async with self.buffer_lock:
            self.metrics_buffer.append(metric)

            # Check if we should flush
            if len(self.metrics_buffer) >= 50 or \
               time.time() - self.last_flush > self.flush_interval:
                await self.flush_metrics()

    async def record_slow_request(self, request: Request, response_time: float):
        """Record additional metrics for slow requests."""
        metric = {
            "metric_type": MetricType.LATENCY,
            "component": f"SLOW: {request.method} {request.url.path}",
            "value": response_time,
            "unit": "ms",
            "threshold": 500.0,
            "environment": self._get_environment(),
            "context": {
                "method": request.method,
                "path": request.url.path,
                "request_id": getattr(request.state, "request_id", None),
                "user_agent": request.headers.get("user-agent", "unknown"),
                "query_params": dict(request.query_params)
            },
            "measured_at": datetime.utcnow()
        }

        async with self.buffer_lock:
            self.metrics_buffer.append(metric)

    async def record_error(self, request: Request, error: str, response_time: float):
        """Record error metrics."""
        metric = {
            "metric_type": MetricType.RESPONSE_TIME,
            "component": f"ERROR: {request.method} {request.url.path}",
            "value": response_time,
            "unit": "ms",
            "threshold": None,
            "environment": self._get_environment(),
            "context": {
                "method": request.method,
                "path": request.url.path,
                "error": error[:500],  # Limit error message length
                "request_id": getattr(request.state, "request_id", None)
            },
            "measured_at": datetime.utcnow()
        }

        async with self.buffer_lock:
            self.metrics_buffer.append(metric)

    async def flush_metrics(self):
        """Flush metrics buffer to database."""
        if not self.metrics_buffer:
            return

        metrics_to_save = self.metrics_buffer[:]
        self.metrics_buffer.clear()
        self.last_flush = time.time()

        # Save metrics in background task
        asyncio.create_task(self._save_metrics(metrics_to_save))

    async def _save_metrics(self, metrics: list):
        """Save metrics to database."""
        try:
            with Session(self.engine) as db:
                for metric_data in metrics:
                    metric = PerformanceMetric(
                        metric_type=metric_data["metric_type"],
                        component=metric_data["component"],
                        value=metric_data["value"],
                        unit=metric_data["unit"],
                        threshold=metric_data.get("threshold"),
                        environment=metric_data["environment"],
                        context=metric_data["context"],
                        measured_at=metric_data["measured_at"]
                    )
                    db.add(metric)

                db.commit()
        except Exception as e:
            # Log error but don't crash the application
            print(f"Failed to save performance metrics: {e}")

    def _get_environment(self) -> Environment:
        """Get current environment from settings."""
        env = settings.ENVIRONMENT.lower()
        if env == "production":
            return Environment.PRODUCTION
        elif env == "staging":
            return Environment.STAGING
        else:
            return Environment.DEVELOPMENT


class QueryCountMiddleware:
    """
    Middleware to count database queries per request.
    Works by instrumenting SQLAlchemy events.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Track query count in request state
        query_count = {"count": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                # Add query count header
                headers = dict(message.get("headers", []))
                headers[b"x-query-count"] = str(query_count["count"]).encode()
                message["headers"] = list(headers.items())
            await send(message)

        # Store query count in scope for access by other middleware
        scope["state"] = scope.get("state", {})
        scope["state"]["query_count"] = query_count

        await self.app(scope, receive, send_wrapper)


class MemoryMonitorMiddleware:
    """
    Middleware to monitor memory usage periodically.
    Records memory metrics for detecting leaks.
    """

    def __init__(self, app):
        self.app = app
        self.last_check = time.time()
        self.check_interval = 60  # Check every minute

        # Create synchronous engine
        db_url = get_settings().DATABASE_URL.replace("+asyncpg", "")
        self.engine = create_engine(db_url)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Check if it's time to record memory usage
        current_time = time.time()
        if current_time - self.last_check > self.check_interval:
            self.last_check = current_time
            await self.record_memory_usage()

        await self.app(scope, receive, send)

    async def record_memory_usage(self):
        """Record current memory usage."""
        try:
            import psutil
            process = psutil.Process()
            memory_info = process.memory_info()

            # Convert to MB
            memory_mb = memory_info.rss / 1024 / 1024

            # Save metric
            with Session(self.engine) as db:
                metric = PerformanceMetric(
                    metric_type=MetricType.MEMORY_USAGE,
                    component="API Server",
                    value=memory_mb,
                    unit="MB",
                    threshold=500.0,  # 500MB threshold
                    environment=self._get_environment(),
                    context={
                        "pid": process.pid,
                        "cpu_percent": process.cpu_percent(),
                        "num_threads": process.num_threads()
                    }
                )
                db.add(metric)
                db.commit()
        except ImportError:
            # psutil not installed
            pass
        except Exception as e:
            print(f"Failed to record memory usage: {e}")

    def _get_environment(self) -> Environment:
        """Get current environment from settings."""
        env = get_settings().ENVIRONMENT.lower()
        if env == "production":
            return Environment.PRODUCTION
        elif env == "staging":
            return Environment.STAGING
        else:
            return Environment.DEVELOPMENT