"""AI prompt template package — locale-aware system prompt builders.

Each submodule exposes a ``build_*_prompt(locale, **ctx)`` function that
returns a fully rendered system prompt for the requested locale. Submodules
must use :func:`app.services.ai_prompts.base.resolve_prompt_locale` to
normalize the incoming locale instead of trusting raw input.
"""

from app.services.ai_prompts.base import (
    language_directive,
    resolve_prompt_locale,
)
from app.services.ai_prompts.chat import build_chat_system_prompt
from app.services.ai_prompts.rules import build_rules_chat_system_prompt

__all__ = [
    "build_chat_system_prompt",
    "build_rules_chat_system_prompt",
    "language_directive",
    "resolve_prompt_locale",
]
