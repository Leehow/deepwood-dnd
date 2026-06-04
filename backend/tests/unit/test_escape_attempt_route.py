from typing import Any

import pytest

from app.api.routes.combat import EscapeAttemptRequest, attempt_escape
from app.models.character import Character
from app.models.token import Token


WEB_EFFECT = {
    "id": "web_restrained",
    "name": "蛛网术",
    "condition": "restrained",
    "source": "法师",
    "spell_save_dc": 14,
    "escape_action": {
        "dc": 14,
        "ability": "strength",
        "type": "check",
    },
    "duration": 10,
    "duration_remaining": 10,
}


class FakeAsyncSession:
    def __init__(self, token: Token, character: Character | None = None) -> None:
        self._objects: dict[tuple[type[Any], int], Any] = {(Token, token.id): token}
        if character is not None:
            self._objects[(Character, character.id)] = character
        self.committed = False

    async def get(self, model: type[Any], object_id: int) -> Any:
        return self._objects.get((model, object_id))

    async def commit(self) -> None:
        self.committed = True


async def _noop_async(*_args: Any, **_kwargs: Any) -> None:
    return None


def _build_character(*, character_id: int, name: str, strength: int, dexterity: int, selected_skills: list[str]) -> Character:
    return Character(
        id=character_id,
        user_id="test-user",
        name=name,
        race_id="human",
        class_id="fighter",
        level=1,
        ability_scores={
            "strength": strength,
            "dexterity": dexterity,
            "constitution": 10,
            "intelligence": 10,
            "wisdom": 10,
            "charisma": 10,
        },
        selected_skills=selected_skills,
        expertise_skills=[],
        race_choices={},
        subclass_choices={},
        status_effects={},
        feat_choices={},
    )


def _build_token(*, token_id: int, character_id: int, name: str) -> Token:
    return Token(
        id=token_id,
        campaign_id=7,
        character_id=character_id,
        user_id="test-user",
        map_url="test-map",
        position_x=100,
        position_y=100,
        token_size="1x1",
        instance_name=name,
        current_hp=10,
        active_effects=[dict(WEB_EFFECT)],
    )


@pytest.mark.asyncio
async def test_escape_attempt_character_token_uses_current_ability_scores(monkeypatch: pytest.MonkeyPatch) -> None:
    character = _build_character(
        character_id=101,
        name="受困战士",
        strength=14,
        dexterity=10,
        selected_skills=[],
    )
    token = _build_token(token_id=201, character_id=character.id, name=character.name)
    db = FakeAsyncSession(token, character)

    monkeypatch.setattr("app.api.routes.combat.random.randint", lambda _a, _b: 12)
    monkeypatch.setattr("app.api.routes.combat._remove_matching_status_entries", _noop_async)
    monkeypatch.setattr("app.api.routes.combat._cleanup_caster_concentration", _noop_async)
    monkeypatch.setattr(
        "app.api.routes.combat.realtime_publisher.publish_token_effects_updated",
        _noop_async,
    )

    result = await attempt_escape(
        EscapeAttemptRequest(campaign_id=7, token_id=token.id, effect_id="web_restrained"),
        db,
    )

    assert result.success is True
    assert result.effect_removed is True
    assert result.total == 14
    assert result.roll.modifier == 2
    assert token.active_effects == []
    assert db.committed is True


@pytest.mark.asyncio
async def test_escape_attempt_character_token_uses_selected_skills_for_strength_escape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    character = _build_character(
        character_id=102,
        name="受困盗贼",
        strength=10,
        dexterity=14,
        selected_skills=["athletics"],
    )
    token = _build_token(token_id=202, character_id=character.id, name=character.name)
    db = FakeAsyncSession(token, character)

    monkeypatch.setattr("app.api.routes.combat.random.randint", lambda _a, _b: 12)
    monkeypatch.setattr("app.api.routes.combat._remove_matching_status_entries", _noop_async)
    monkeypatch.setattr("app.api.routes.combat._cleanup_caster_concentration", _noop_async)
    monkeypatch.setattr(
        "app.api.routes.combat.realtime_publisher.publish_token_effects_updated",
        _noop_async,
    )

    result = await attempt_escape(
        EscapeAttemptRequest(campaign_id=7, token_id=token.id, effect_id="web_restrained"),
        db,
    )

    assert result.success is True
    assert result.effect_removed is True
    assert result.total == 14
    assert result.roll.modifier == 2
