from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.character import Character
from app.models.token import Token
from app.schemas.combat import AbilityCheckParticipant, AbilityCheckRequest, AbilityScores, ContestRequest
from app.services.combat_check_usecase_service import resolve_ability_check, resolve_contest


class DummySession:
    def __init__(self, mapping: dict[tuple[type, int], object] | None = None):
        self.mapping = mapping or {}
        self.committed = False

    async def get(self, model: type, ident: int):
        return self.mapping.get((model, ident))

    async def commit(self):
        self.committed = True


@pytest.mark.asyncio
async def test_resolve_ability_check_builds_result_and_chat_meta(monkeypatch):
    db = DummySession()
    request = AbilityCheckRequest(
        campaign_id=7,
        participant=AbilityCheckParticipant(
            name="游荡者",
            token_id=11,
            ability_scores=AbilityScores(
                strength=10,
                dexterity=16,
                constitution=12,
                intelligence=14,
                wisdom=13,
                charisma=10,
            ),
            level=5,
            proficiency_bonus=3,
            check_modifier_override=7,
        ),
        check_type="stealth",
        dc=18,
        description="尝试潜行",
    )

    monkeypatch.setattr(
        "app.services.combat_check_usecase_service.random.randint",
        lambda _a, _b: 15,
    )

    execution = await resolve_ability_check(db=db, request=request)

    assert execution.result.participant_name == "游荡者"
    assert execution.result.check_total == 22
    assert execution.result.success is True
    assert execution.chat_meta["combat_type"] == "ability_check"
    assert "游荡者" in execution.combat_content


@pytest.mark.asyncio
async def test_resolve_contest_applies_grapple_effect_and_returns_update(monkeypatch):
    defender_token = SimpleNamespace(
        id=22,
        active_effects=[],
        monster_instance_id=None,
        character_id=33,
    )
    defender_character = SimpleNamespace(
        id=33,
        status_effects={},
        equipment=[],
    )
    db = DummySession(
        {
            (Token, 22): defender_token,
            (Character, 33): defender_character,
        }
    )
    request = ContestRequest(
        campaign_id=7,
        contest_type="grapple",
        attacker=AbilityCheckParticipant(
            name="战士",
            token_id=11,
            ability_scores=AbilityScores(
                strength=18,
                dexterity=10,
                constitution=14,
                intelligence=10,
                wisdom=10,
                charisma=10,
            ),
            level=5,
            proficiency_bonus=3,
            proficient_skills=["athletics"],
            check_modifier_override=8,
        ),
        defender=AbilityCheckParticipant(
            name="食尸鬼",
            token_id=22,
            character_id=33,
            ability_scores=AbilityScores(
                strength=10,
                dexterity=12,
                constitution=12,
                intelligence=8,
                wisdom=10,
                charisma=6,
            ),
            level=2,
            proficiency_bonus=2,
            check_modifier_override=1,
        ),
    )

    rolls = iter([15, 6])
    monkeypatch.setattr(
        "app.services.combat_check_usecase_service.random.randint",
        lambda _a, _b: next(rolls),
    )
    monkeypatch.setattr(
        "app.services.combat_check_usecase_service.check_armor_proficiency_penalty",
        lambda _character: {"has_penalty": False},
    )

    # The contest maps a real defender Token, so _build_check_roll reaches the
    # runtime-modifier loader (db.execute). DummySession is intentionally minimal,
    # so stub the loader — this test is not about runtime spell effects.
    async def _no_runtime(*_a, **_k):
        return []

    monkeypatch.setattr(
        "app.services.combat_check_usecase_service.get_token_runtime_modifier_effects",
        _no_runtime,
    )

    execution = await resolve_contest(db=db, request=request)

    assert execution.result.attacker_wins is True
    assert execution.result.effect_applied == "grappled"
    assert execution.effect_update is not None
    assert execution.effect_update.token_id == 22
    assert execution.effect_update.character_id == 33
    assert db.committed is True
    assert defender_token.active_effects
    assert defender_token.active_effects[0]["condition"] == "grappled"
    assert defender_character.status_effects["active_conditions"][0]["condition"] == "grappled"
