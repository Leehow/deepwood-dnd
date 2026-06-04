from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes.tokens import update_token_transformation
from app.schemas.token import TokenTransformationUpdate


class _FakeExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, token):
        self._token = token
        self.execute_calls = 0

    async def execute(self, _statement):
        self.execute_calls += 1
        return _FakeExecuteResult(self._token)


@pytest.mark.asyncio
async def test_update_token_transformation_rejects_size_changing_spell_shortcut():
    token = SimpleNamespace(
        id=11,
        character_id=None,
        instance_name="瓦莱里乌斯·加兰诺德",
        transformation_data=None,
    )
    db = _FakeDB(token)
    payload = TokenTransformationUpdate(
        transformation_data={
            "source": {
                "config_id": "enlarge-reduce",
                "spell_id": "enlarge-reduce",
                "spell_name": "变巨 / 缩小术",
            },
            "type": "modifier",
            "activeMode": "enlarge",
            "original_size": "中型",
            "size": "大型",
        },
        caster_token_id=22,
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_token_transformation(
            token_id=token.id,
            payload=payload,
            db=db,  # type: ignore[arg-type]
            current_user={"id": 1},
        )

    assert db.execute_calls == 1
    assert exc_info.value.status_code == 400
    assert "统一施法链" in exc_info.value.detail
