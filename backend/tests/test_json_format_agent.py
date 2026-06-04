import pytest
from typing import List, Dict


@pytest.mark.asyncio
async def test_ensure_strict_json_success_first_try(monkeypatch):
    # Ensure required env vars exist before importing app modules
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    # Import after env is set
    from app.services.json_format_agent import ensure_strict_json
    from app.services.ai_service import AIService

    calls: List[List[Dict[str, str]]] = []

    async def fake_generate_completion(api_url: str, api_key: str, model: str,
                                       messages: List[Dict[str, str]],
                                       temperature: float = 0.2, max_tokens: int = 800) -> str:
        calls.append(messages)
        return '{"ability":"strength","dc":15,"dice":"1d20","description":"test"}'

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_generate_completion))

    result = await ensure_strict_json(
        api_url="http://dummy",
        api_key="dummy",
        model="gpt-5",
        messages=[{"role": "system", "content": "Return JSON"}, {"role": "user", "content": "desc"}],
        schema_hint='{"ability":"string?","skill":"string?","dc":"number?","dice":"string?","description":"string?"}',
        temperature=0.2,
        max_tokens=200,
        max_attempts=3,
    )

    assert isinstance(result, dict)
    assert result.get("ability") == "strength"
    assert result.get("dc") == 15
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_ensure_strict_json_retry_and_fix(monkeypatch):
    # Ensure required env vars exist before importing app modules
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    # Import after env is set
    from app.services.json_format_agent import ensure_strict_json
    from app.services.ai_service import AIService

    calls: List[List[Dict[str, str]]] = []
    responses = [
        # First attempt: non-JSON text
        "能力是力量，DC=15。请给出JSON。",
        # Second attempt (fixer): JSON inside code fence
        """```json
{"ability":"strength","dc":15}
```""",
    ]
    idx = {"i": 0}

    async def fake_generate_completion(api_url: str, api_key: str, model: str,
                                       messages: List[Dict[str, str]],
                                       temperature: float = 0.2, max_tokens: int = 800) -> str:
        calls.append(messages)
        i = idx["i"]
        idx["i"] = min(i + 1, len(responses) - 1)
        return responses[i]

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_generate_completion))

    result = await ensure_strict_json(
        api_url="http://dummy",
        api_key="dummy",
        model="qwen-turbo",
        messages=[{"role": "system", "content": "Return JSON"}, {"role": "user", "content": "desc"}],
        schema_hint='{"ability":"string?","skill":"string?","dc":"number?","dice":"string?","description":"string?"}',
        temperature=0.2,
        max_tokens=200,
        max_attempts=3,
    )

    assert isinstance(result, dict)
    assert result.get("ability") == "strength"
    assert result.get("dc") == 15
    # Should have called AI at least twice (initial + fixer)
    assert len(calls) >= 2

