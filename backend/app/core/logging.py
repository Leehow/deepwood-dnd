"""
Structured logging configuration for D&D platform.
Replaces print() statements with proper logging.
"""

import logging
import sys
import json
from typing import Any, Dict, Optional
from datetime import datetime
from pathlib import Path
import traceback

from app.core.config import settings


class JSONFormatter(logging.Formatter):
    """Format logs as JSON for better observability."""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
                "traceback": traceback.format_exception(*record.exc_info)
            }

        # Add custom fields from extra
        if hasattr(record, "extra_fields"):
            log_data.update(record.extra_fields)

        # Add request context if available
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id

        if hasattr(record, "user_id"):
            log_data["user_id"] = record.user_id

        if hasattr(record, "campaign_id"):
            log_data["campaign_id"] = record.campaign_id

        return json.dumps(log_data)


class ContextLogger:
    """Logger with request context."""

    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.context: Dict[str, Any] = {}

    def with_context(self, **kwargs) -> "ContextLogger":
        """Add context to logger."""
        new_logger = ContextLogger(self.logger)
        new_logger.context = {**self.context, **kwargs}
        return new_logger

    def _log(self, level: int, message: str, **kwargs):
        """Log with context."""
        extra = {"extra_fields": {**self.context, **kwargs}}
        self.logger.log(level, message, extra=extra)

    def debug(self, message: str, **kwargs):
        self._log(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        self._log(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        self._log(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs):
        self._log(logging.ERROR, message, **kwargs)

    def critical(self, message: str, **kwargs):
        self._log(logging.CRITICAL, message, **kwargs)

    def exception(self, message: str, **kwargs):
        """Log exception with traceback."""
        self.logger.exception(message, extra={"extra_fields": {**self.context, **kwargs}})


def setup_logging(
    log_level: str = "INFO",
    log_file: Optional[Path] = None,
    json_format: bool = True
) -> None:
    """
    Setup logging configuration.

    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional file path for logs
        json_format: Whether to use JSON formatting
    """
    # Create logs directory if needed
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))

    # Clear existing handlers
    root_logger.handlers.clear()

    # Create formatter
    if json_format:
        formatter = JSONFormatter()
    else:
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    # Suppress noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # Set app logger levels
    logging.getLogger("app").setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)
    logging.getLogger("app.websocket").setLevel(logging.DEBUG)
    logging.getLogger("app.parsing").setLevel(logging.INFO)
    logging.getLogger("app.ai").setLevel(logging.INFO)


def get_logger(name: str) -> ContextLogger:
    """
    Get a logger with context support.

    Args:
        name: Logger name (usually __name__)

    Returns:
        ContextLogger instance
    """
    return ContextLogger(logging.getLogger(name))


# Module-specific loggers with categories
class LoggerFactory:
    """Factory for creating categorized loggers."""

    @staticmethod
    def websocket(handler_name: str) -> ContextLogger:
        """Get WebSocket handler logger."""
        return get_logger(f"app.websocket.{handler_name}")

    @staticmethod
    def api(route_name: str) -> ContextLogger:
        """Get API route logger."""
        return get_logger(f"app.api.{route_name}")

    @staticmethod
    def parsing(parser_name: str) -> ContextLogger:
        """Get parser logger."""
        return get_logger(f"app.parsing.{parser_name}")

    @staticmethod
    def service(service_name: str) -> ContextLogger:
        """Get service logger."""
        return get_logger(f"app.service.{service_name}")

    @staticmethod
    def database(operation: str) -> ContextLogger:
        """Get database operation logger."""
        return get_logger(f"app.db.{operation}")


# Initialize logging on import
if settings.ENVIRONMENT == "production":
    setup_logging(
        log_level="INFO",
        json_format=True,
        log_file=Path("logs/app.log")
    )
else:
    setup_logging(
        log_level="DEBUG" if settings.DEBUG else "INFO",
        json_format=False
    )