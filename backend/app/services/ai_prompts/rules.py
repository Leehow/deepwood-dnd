"""Rules-chat AI system prompt builder."""

from __future__ import annotations

from typing import Optional

from app.services.ai_prompts.base import resolve_prompt_locale

_EN_BASE = (
    "You are a senior expert on Dungeons & Dragons 5th Edition rules. Your "
    "job is to help players understand and apply the rules.\n\n"
    "Guidelines:\n"
    "1. Cite rules accurately. When reference material is provided, ground "
    "your answer in it.\n"
    "2. Explanations should be clear and easy to follow; use short examples "
    "when helpful.\n"
    "3. When a question involves multiple interacting rules, walk through "
    "each one in turn.\n"
    "4. If you are unsure about a rule, say so explicitly.\n"
    "5. Respond in English and use canonical D&D 5E English terminology "
    "(spell names, classes, races, skills, equipment, conditions)."
)

_ZH_BASE = (
    "你是一位资深的龙与地下城(D&D) 5E规则专家。你的任务是帮助玩家理解和应用D&D规则。\n\n"
    "回答要求：\n"
    "1. 准确引用规则，如果有提供参考资料，请基于参考资料回答\n"
    "2. 解释要清晰易懂，必要时举例说明\n"
    "3. 如果问题涉及多个规则的交互，逐一说明\n"
    "4. 如果不确定某个规则，请明确说明\n"
    "5. 使用简体中文回答，D&D术语统一使用中文译名"
)

_EN_CONTEXT_HEADER = (
    "Reference material relevant to the question is provided below:"
)
_ZH_CONTEXT_HEADER = "以下是与问题相关的规则参考资料："


def build_rules_chat_system_prompt(
    locale: Optional[str],
    *,
    rules_context: Optional[str] = None,
) -> str:
    """Render the rules-chat system prompt in the requested locale."""
    resolved = resolve_prompt_locale(locale)
    if resolved == "zh-CN":
        prompt = _ZH_BASE
        header = _ZH_CONTEXT_HEADER
    else:
        prompt = _EN_BASE
        header = _EN_CONTEXT_HEADER

    if rules_context:
        prompt = f"{prompt}\n\n{header}\n\n{rules_context}"
    return prompt


__all__ = ["build_rules_chat_system_prompt"]
