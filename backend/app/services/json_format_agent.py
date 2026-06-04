import json
import re
from typing import Any, Dict, List, Optional

from .ai_service import AIService


def _extract_json_from_text(text: str) -> Optional[Any]:
    """Best-effort extraction of JSON object/array from arbitrary text.
    Strategy:
    1) Try fenced code blocks (```json ... ``` or ``` ... ```)
    2) Otherwise, scan for first balanced {...} or [...] segment and json.loads
    """
    if not text:
        return None

    # 1) Try fenced code blocks
    fence_pattern = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
    for m in fence_pattern.finditer(text):
        candidate = m.group(1).strip()
        try:
            return json.loads(candidate)
        except Exception:
            # try to sanitize trivial trailing commas
            try:
                sanitized = candidate.replace("\n", " ").strip()
                return json.loads(sanitized)
            except Exception:
                continue

    # 2) Balanced bracket scan
    def find_json_segment(s: str) -> Optional[str]:
        openings = [i for i, ch in enumerate(s) if ch in "[{"]
        for start in openings:
            stack: List[str] = []
            for i in range(start, len(s)):
                ch = s[i]
                if ch in "[{":
                    stack.append(ch)
                elif ch in "]}":
                    if not stack:
                        break
                    open_ch = stack.pop()
                    if (open_ch == "[" and ch != "]") or (open_ch == "{" and ch != "}"):
                        break
                    if not stack:
                        return s[start : i + 1]
        return None

    seg = find_json_segment(text)
    if seg is None:
        return None
    try:
        return json.loads(seg)
    except Exception:
        return None


async def ensure_strict_json(
    *,
    api_url: str,
    api_key: str,
    model: str,
    messages: List[Dict[str, str]],
    schema_hint: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 800,
    max_attempts: int = 3,
) -> Any:
    """Call AI to produce STRICT JSON. If the first response is not valid JSON,
    use a JSON-fixer prompt up to max_attempts times (total attempts including first).

    Returns parsed JSON (object or array). Raises ValueError if still invalid after retries.
    """
    # 1) First attempt with given messages
    content = await AIService.generate_completion(
        api_url=api_url,
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    parsed = _extract_json_from_text(content)
    if parsed is not None:
        return parsed

    # 2) Retry with JSON-fixer agent prompt
    attempts = 1
    # Provide a concise schema hint if available to improve reliability
    schema_text = "" if not schema_hint else f"\n\n要求的JSON结构（简要轮廓，可忽略未知字段）：\n{schema_hint}"

    while attempts < max_attempts:
        validate_prompt = (
            "以下内容应该是JSON格式，但可能格式有误。请提取并修复为有效的JSON格式，"
            "只返回纯JSON，不要有markdown代码块标记或其他文字：\n\n"
            f"{content}\n"
            f"{schema_text}"
        )
        fixed = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": validate_prompt}],
            temperature=0.1,
            max_tokens=max_tokens,
        )
        parsed = _extract_json_from_text(fixed)
        attempts += 1
        if parsed is not None:
            return parsed
        # prepare for next round using the latest model text
        content = fixed

    raise ValueError("Failed to obtain valid JSON after retries")

