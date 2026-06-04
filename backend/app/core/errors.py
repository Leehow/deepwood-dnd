"""Structured application errors for the English-canonical i18n migration.

This module introduces :class:`AppError`, an exception that carries a stable
machine-readable error ``code`` plus optional ``params``, instead of relying
on a localized ``detail`` string the way ``HTTPException`` does today. The
frontend localizes the response via a translation table keyed on ``code``;
the server only ships an English ``message`` as a debug/log fallback.

Response envelope produced by :func:`app_error_handler`::

    {
        "error": {
            "code": "character.equipment.slot_occupied",
            "params": {"slot": "main_hand"},
            "message": "Slot is already occupied"
        }
    }

``AppError.detail`` is preserved so legacy ``except HTTPException as e: e.detail``
consumers (and tests that read ``response.json()["detail"]``) keep working
during the gradual migration off ``HTTPException``.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from fastapi import Request, status
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Stable, machine-readable application error.

    ``code`` is the durable contract (dot-namespaced, English snake/dot).
    ``params`` carries interpolation values the frontend needs to render the
    localized string. ``message`` is an English fallback for logs and curl
    debugging — it is NOT the canonical user-facing string.
    """

    __slots__ = ("code", "params", "status_code", "message")

    def __init__(
        self,
        code: str,
        *,
        message: str,
        params: Optional[Mapping[str, Any]] = None,
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        if not code:
            raise ValueError("AppError.code must be a non-empty string")
        if not message:
            raise ValueError("AppError.message must be a non-empty string")
        self.code = code
        self.params: dict[str, Any] = dict(params) if params else {}
        self.status_code = int(status_code)
        self.message = message
        super().__init__(message)

    @property
    def default_message(self) -> str:
        """Alias for the English fallback message."""
        return self.message

    @property
    def detail(self) -> str:
        """Compatibility shim for legacy ``HTTPException``-style consumers."""
        return self.message

    def to_envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "params": dict(self.params),
                "message": self.message,
            }
        }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:  # noqa: ARG001
    """FastAPI exception handler that emits the structured error envelope."""
    return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())


__all__ = ["AppError", "app_error_handler"]
