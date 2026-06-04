"""WebSocket in-game AI chat system prompt builder."""

from __future__ import annotations

from typing import Optional

from app.services.ai_prompts.base import resolve_prompt_locale

_EN_BASE = (
    "You are a D&D 5E tabletop assistant. Respond concisely in English and "
    "use canonical D&D 5E English terminology for spells, classes, races, "
    "skills, equipment, and conditions. Recent chat history is provided "
    "below — use it as context when answering."
)

_ZH_BASE = (
    "你是D&D 5E 跑团助手。请用简洁中文回答，所有D&D术语（法术名、职业、种族、"
    "技能、装备等）统一使用中文名称。以下是最近的聊天记录，请结合上下文回答。"
)

# Section headers and the trailing UI-context hint, kept locale-symmetric so
# downstream callers don't need to assemble templating themselves.
_HEADERS = {
    "en-US": {
        "character": "[Player character]",
        "ui_context": "[Player's current UI action]",
        "ui_hint": (
            "Tailor your reply to what the player is currently doing and to "
            "their character information. For example, when recommending "
            "equipment, factor in class proficiencies; when recommending "
            "skills, factor in ability scores and existing picks."
        ),
    },
    "zh-CN": {
        "character": "【玩家角色信息】",
        "ui_context": "【玩家当前操作】",
        "ui_hint": (
            "请根据玩家正在进行的操作和角色信息提供针对性的帮助。"
            "例如：推荐装备时考虑职业熟练项，推荐技能时考虑属性值和已有选择。"
        ),
    },
}


def build_chat_system_prompt(
    locale: Optional[str],
    *,
    character_context: Optional[str] = None,
    ui_context: Optional[str] = None,
) -> str:
    """Render the in-game AI chat system prompt in the requested locale."""
    resolved = resolve_prompt_locale(locale)
    base = _ZH_BASE if resolved == "zh-CN" else _EN_BASE
    headers = _HEADERS[resolved]

    parts: list[str] = [base]
    if character_context:
        parts.append(f"{headers['character']}{character_context}")
    if ui_context:
        parts.append(f"{headers['ui_context']}{ui_context}\n{headers['ui_hint']}")
    return "\n\n".join(parts)


__all__ = ["build_chat_system_prompt"]
