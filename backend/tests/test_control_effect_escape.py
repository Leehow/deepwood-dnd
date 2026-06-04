"""
Test script for control effect escape/save/wake-up APIs.
Tests the following endpoints:
- POST /api/combat/ongoing-save
- POST /api/combat/escape-attempt
- POST /api/combat/remove-effect (wake up)
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from types import SimpleNamespace

from app.api.routes import combat, tokens as token_routes
from app.models.token import Token
from app.models.campaign import Campaign
from app.services.spell_resolver import SpellContext


# Test data for control effects
HOLD_PERSON_EFFECT = {
    "id": "hold_person_paralyzed",
    "name": "人类定身术",
    "condition": "paralyzed",
    "source": "法师",
    "spell_save_dc": 15,
    "ongoing_save": {
        "dc": 15,
        "save_type": "wisdom",
        "timing": "end_of_turn"
    },
    "duration": 10,
    "duration_remaining": 10
}

WEB_EFFECT = {
    "id": "web_restrained",
    "name": "蛛网术",
    "condition": "restrained",
    "source": "法师",
    "spell_save_dc": 14,
    "escape_action": {
        "dc": 14,
        "ability": "strength",
        "type": "check"
    },
    "duration": 10,
    "duration_remaining": 10
}

SLEEP_EFFECT = {
    "id": "sleep_unconscious",
    "name": "睡眠术",
    "condition": "unconscious",
    "source": "法师",
    "break_conditions": ["damage", "shaken"],
    "duration": 10,
    "duration_remaining": 10
}


def _build_enlarge_reduce_transformation(active_mode: str = "enlarge") -> dict:
    return {
        "source": {
            "config_id": "enlarge-reduce",
            "spell_id": "enlarge-reduce",
            "spell_name": "变巨 / 缩小术",
        },
        "type": "modifier",
        "activeMode": active_mode,
        "original_size": "中型",
        "size": "大型" if active_mode == "enlarge" else "小型",
    }


def _build_enlarge_reduce_effect(caster_token_id: int) -> dict:
    return {
        "id": "enlarge-reduce_buff",
        "name": "变巨",
        "source": "变巨 / 缩小术",
        "spell_id": "enlarge-reduce",
        "spell_buff": True,
        "is_concentration": True,
        "source_token_id": caster_token_id,
        "ongoing_save": {
            "timing": "end_of_turn",
            "save_type": "constitution",
            "dc": 13,
        },
        "spell_save_dc": 13,
        "duration": 10,
        "duration_remaining": 10,
    }


@pytest.fixture
async def token_with_hold_person(db_session: AsyncSession, test_campaign: Campaign):
    """Create a test token with Hold Person effect."""
    token = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="被定身的战士",
        position_x=100,
        position_y=100,
        token_size="1x1",
        current_hp=30,
        active_effects=[HOLD_PERSON_EFFECT]
    )
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)
    return token


@pytest.fixture
async def concentration_hold_person_tokens(db_session: AsyncSession, test_campaign: Campaign):
    """Create caster/target tokens linked by a concentration-based Hold Person effect."""
    caster = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="施法者",
        position_x=50,
        position_y=50,
        token_size="1x1",
        current_hp=20,
        concentration_spell={
            "spell_id": "hold-person",
            "spell_name": "人类定身术",
            "affected_token_ids": [],
        },
    )
    db_session.add(caster)
    await db_session.commit()
    await db_session.refresh(caster)

    effect = {
        **HOLD_PERSON_EFFECT,
        "spell_id": "hold-person",
        "source_token_id": caster.id,
    }
    target = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="被定身的战士",
        position_x=100,
        position_y=100,
        token_size="1x1",
        current_hp=30,
        active_effects=[effect],
    )
    db_session.add(target)
    await db_session.commit()
    await db_session.refresh(target)

    caster.concentration_spell = {
        "spell_id": "hold-person",
        "spell_name": "人类定身术",
        "affected_token_ids": [target.id],
    }
    await db_session.commit()
    await db_session.refresh(caster)

    return {"caster": caster, "target": target}


@pytest.fixture
async def token_with_web(db_session: AsyncSession, test_campaign: Campaign):
    """Create a test token with Web effect."""
    token = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="被蛛网困住的盗贼",
        position_x=200,
        position_y=100,
        token_size="1x1",
        current_hp=25,
        active_effects=[WEB_EFFECT]
    )
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)
    return token




@pytest.fixture
async def token_with_sleep(db_session: AsyncSession, test_campaign: Campaign):
    """Create a test token with Sleep effect."""
    token = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="昏睡的平民",
        position_x=300,
        position_y=100,
        token_size="1x1",
        current_hp=10,
        active_effects=[SLEEP_EFFECT]
    )
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)
    return token


@pytest.fixture
async def enlarge_reduce_tokens(db_session: AsyncSession, test_campaign: Campaign):
    """Create a caster and two targets for enlarge/reduce transform-path tests."""
    caster = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="施法者",
        position_x=50,
        position_y=50,
        token_size="1x1",
        current_hp=20,
    )
    target_one = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="目标一",
        position_x=100,
        position_y=100,
        token_size="1x1",
        current_hp=30,
    )
    target_two = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="test-map",
        instance_name="目标二",
        position_x=150,
        position_y=100,
        token_size="1x1",
        current_hp=28,
    )
    db_session.add_all([caster, target_one, target_two])
    await db_session.commit()
    await db_session.refresh(caster)
    await db_session.refresh(target_one)
    await db_session.refresh(target_two)
    return {"caster": caster, "targets": [target_one, target_two]}


async def _seed_enlarge_reduce_state(
    db_session: AsyncSession,
    caster: Token,
    targets: list[Token],
) -> None:
    caster.concentration_spell = {
        "spell_id": "enlarge-reduce",
        "spell_name": "变巨 / 缩小术",
        "affected_token_ids": [target.id for target in targets],
    }
    for target in targets:
        target.transformation_data = _build_enlarge_reduce_transformation()
        target.token_size = "2x2"
        target.active_effects = [_build_enlarge_reduce_effect(caster.id)]
    await db_session.commit()


class TestOngoingSave:
    """Test ongoing save for effects like Hold Person."""

    @pytest.mark.asyncio
    async def test_ongoing_save_success(
        self,
        client: AsyncClient,
        token_with_hold_person: Token,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Test successful ongoing save removes effect."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 18)
        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": token_with_hold_person.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["effect_removed"] is True
        assert "人类定身术" in data["narrative"]

    @pytest.mark.asyncio
    async def test_ongoing_save_failure(
        self,
        client: AsyncClient,
        token_with_hold_person: Token,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Test failed ongoing save keeps effect."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 5)
        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": token_with_hold_person.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["effect_removed"] is False

    @pytest.mark.asyncio
    async def test_ongoing_save_success_broadcasts_effect_chat_and_clears_concentration(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        concentration_hold_person_tokens,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Successful ongoing save should sync token effects, combat chat, and concentration cleanup."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 18)
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)

        target = concentration_hold_person_tokens["target"]
        caster = concentration_hold_person_tokens["caster"]
        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": target.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["effect_removed"] is True
        assert data["save_total"] == 18
        assert data["save_dc"] == 15

        await db_session.refresh(target)
        await db_session.refresh(caster)
        assert target.active_effects == []
        assert caster.concentration_spell is None

        message_types = [item["message"]["type"] for item in broadcasts]
        assert message_types == [
            "token_concentration_update",
            "token_active_effects_update",
            "chat",
        ]

        concentration_update = broadcasts[0]["message"]
        assert concentration_update["token_id"] == caster.id
        assert concentration_update["concentration_spell"] is None

        effects_update = broadcasts[1]["message"]
        assert effects_update["token_id"] == target.id
        assert effects_update["active_effects"] == []

        chat_update = broadcasts[2]["message"]
        assert chat_update["message_type"] == "combat"
        assert chat_update["role"] == "system"
        assert "人类定身术" in chat_update["message"]
        assert str(test_campaign.id) == broadcasts[2]["campaign_id"]

    @pytest.mark.asyncio
    async def test_ongoing_save_success_cleans_concentration_for_camel_case_effect(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        concentration_hold_person_tokens,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Successful ongoing save should clear concentration for camelCase zone-style effects."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 18)
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)

        target = concentration_hold_person_tokens["target"]
        caster = concentration_hold_person_tokens["caster"]
        target.active_effects = [{
            **HOLD_PERSON_EFFECT,
            "sourceSpell": "hold-person",
            "sourceTokenId": caster.id,
            "saveDc": 15,
            "saveType": "wisdom",
        }]
        await db_session.commit()
        await db_session.refresh(target)

        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": target.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["effect_removed"] is True

        await db_session.refresh(target)
        await db_session.refresh(caster)
        assert target.active_effects == []
        assert caster.concentration_spell is None

        assert [item["message"]["type"] for item in broadcasts] == [
            "token_concentration_update",
            "token_active_effects_update",
            "chat",
        ]
        assert broadcasts[0]["message"]["token_id"] == caster.id
        assert broadcasts[0]["message"]["concentration_spell"] is None


    @pytest.mark.asyncio
    async def test_ongoing_save_failure_broadcasts_effect_update_and_chat(
        self,
        client: AsyncClient,
        token_with_hold_person: Token,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Failed ongoing save should still broadcast sync + combat chat with current protocol."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 5)
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)

        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": token_with_hold_person.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["effect_removed"] is False
        assert data["save_total"] == 5
        assert data["save_dc"] == 15

        assert [item["message"]["type"] for item in broadcasts] == [
            "token_active_effects_update",
            "chat",
        ]
        assert broadcasts[0]["message"]["active_effects"] == [HOLD_PERSON_EFFECT]
        assert broadcasts[1]["message"]["message_type"] == "combat"
        assert "效果持续" in broadcasts[1]["message"]["message"]

    @pytest.mark.asyncio
    async def test_ongoing_save_effect_not_found(
        self,
        client: AsyncClient,
        token_with_hold_person: Token,
        test_campaign: Campaign
    ):
        """Test ongoing save with non-existent effect."""
        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": token_with_hold_person.id,
                "effect_id": "non_existent_effect",
                "campaign_id": test_campaign.id,
                "roll_result": 15
            }
        )
        assert response.status_code == 404


class TestEscapeAttempt:
    """Test escape attempt for effects like Web."""

    @pytest.mark.asyncio
    async def test_escape_attempt_success(
        self,
        client: AsyncClient,
        token_with_web: Token,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Test successful escape attempt removes effect."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 17)
        response = await client.post(
            "/api/combat/escape-attempt",
            json={
                "token_id": token_with_web.id,
                "effect_id": "web_restrained",
                "campaign_id": test_campaign.id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["effect_removed"] is True
        assert "蛛网术" in data["narrative"]

    @pytest.mark.asyncio
    async def test_escape_attempt_failure(
        self,
        client: AsyncClient,
        token_with_web: Token,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """Test failed escape attempt keeps effect."""
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 8)
        response = await client.post(
            "/api/combat/escape-attempt",
            json={
                "token_id": token_with_web.id,
                "effect_id": "web_restrained",
                "campaign_id": test_campaign.id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["effect_removed"] is False

    @pytest.mark.asyncio
    async def test_escape_attempt_no_escape_action(
        self,
        client: AsyncClient,
        token_with_hold_person: Token,
        test_campaign: Campaign
    ):
        """Test escape attempt on effect without escape_action."""
        response = await client.post(
            "/api/combat/escape-attempt",
            json={
                "token_id": token_with_hold_person.id,
                "effect_id": "hold_person_paralyzed",
                "campaign_id": test_campaign.id,
                "roll_result": 20
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "cannot be escaped" in data["detail"].lower()



class TestEnlargeReduceSpellCleanup:
    """Test unified spell-based Enlarge/Reduce cleanup without the legacy transform shortcut."""

    @pytest.mark.asyncio
    async def test_transform_route_rejects_legacy_enlarge_reduce_shortcut(
        self,
        client: AsyncClient,
        enlarge_reduce_tokens,
        dm_auth_headers: dict,
    ):
        """Size-changing spells must no longer use the legacy /transform shortcut."""
        target = enlarge_reduce_tokens["targets"][0]
        response = await client.post(
            f"/api/tokens/{target.id}/transform",
            json={"transformation_data": _build_enlarge_reduce_transformation()},
            headers=dm_auth_headers,
        )
        assert response.status_code == 400
        assert "统一施法链" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_ongoing_save_clears_single_target_concentration_for_spell_size_change(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        enlarge_reduce_tokens,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """A successful save should drop the last affected target and end concentration."""
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 18)

        caster = enlarge_reduce_tokens["caster"]
        target = enlarge_reduce_tokens["targets"][0]

        await _seed_enlarge_reduce_state(db_session, caster, [target])

        await db_session.refresh(caster)
        await db_session.refresh(target)

        broadcasts.clear()

        save_response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": target.id,
                "effect_id": "enlarge-reduce_buff",
                "campaign_id": test_campaign.id,
            },
        )
        assert save_response.status_code == 200
        save_data = save_response.json()
        assert save_data["success"] is True
        assert save_data["effect_removed"] is True

        await db_session.refresh(caster)
        await db_session.refresh(target)

        assert target.transformation_data is None
        assert target.active_effects == []
        assert target.token_size == "1x1"
        assert caster.concentration_spell is None

        assert [item["message"]["type"] for item in broadcasts] == [
            "transformation_update",
            "token_concentration_update",
            "token_active_effects_update",
            "chat",
        ]
        assert broadcasts[1]["message"]["concentration_spell"] is None
        assert broadcasts[2]["message"]["token_id"] == target.id
        assert broadcasts[2]["message"]["active_effects"] == []

    @pytest.mark.asyncio
    async def test_ongoing_save_after_spell_size_change_keeps_other_targets_on_concentration(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        enlarge_reduce_tokens,
        test_campaign: Campaign,
        monkeypatch,
    ):
        """A saved target should be removed from concentration tracking without dropping other targets."""
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 18)

        caster = enlarge_reduce_tokens["caster"]
        first_target, second_target = enlarge_reduce_tokens["targets"]

        await _seed_enlarge_reduce_state(db_session, caster, [first_target, second_target])

        await db_session.refresh(caster)
        await db_session.refresh(first_target)
        await db_session.refresh(second_target)

        assert caster.concentration_spell is not None
        assert caster.concentration_spell["affected_token_ids"] == [first_target.id, second_target.id]

        broadcasts.clear()

        save_response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": first_target.id,
                "effect_id": "enlarge-reduce_buff",
                "campaign_id": test_campaign.id,
            },
        )
        assert save_response.status_code == 200
        save_data = save_response.json()
        assert save_data["success"] is True
        assert save_data["effect_removed"] is True

        await db_session.refresh(caster)
        await db_session.refresh(first_target)
        await db_session.refresh(second_target)

        assert first_target.transformation_data is None
        assert first_target.active_effects == []
        assert first_target.token_size == "1x1"
        assert second_target.transformation_data is not None
        assert second_target.active_effects and second_target.active_effects[0]["id"] == "enlarge-reduce_buff"
        assert second_target.token_size == "2x2"
        assert caster.concentration_spell is not None
        assert caster.concentration_spell["affected_token_ids"] == [second_target.id]

        assert [item["message"]["type"] for item in broadcasts] == [
            "transformation_update",
            "token_concentration_update",
            "token_active_effects_update",
            "chat",
        ]
        assert broadcasts[1]["message"]["concentration_spell"]["affected_token_ids"] == [second_target.id]
        assert broadcasts[2]["message"]["token_id"] == first_target.id
        assert broadcasts[2]["message"]["active_effects"] == []

class TestWakeUp:
    """Test wake up (remove effect with reason=shaken) for effects like Sleep."""

    @pytest.mark.asyncio
    async def test_wake_up_success(
        self,
        client: AsyncClient,
        token_with_sleep: Token,
        test_campaign: Campaign
    ):
        """Test waking up a sleeping creature."""
        response = await client.post(
            "/api/combat/remove-effect",
            params={
                "campaign_id": test_campaign.id,
                "token_id": token_with_sleep.id,
                "effect_id": "sleep_unconscious",
                "reason": "shaken"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["reason"] == "shaken"
        assert "被摇醒" in data["narrative"]

    @pytest.mark.asyncio
    async def test_wake_up_effect_not_found(
        self,
        client: AsyncClient,
        token_with_sleep: Token,
        test_campaign: Campaign
    ):
        """Test wake up with non-existent effect."""
        response = await client.post(
            "/api/combat/remove-effect",
            params={
                "campaign_id": test_campaign.id,
                "token_id": token_with_sleep.id,
                "effect_id": "non_existent_effect",
                "reason": "shaken"
            }
        )
        assert response.status_code == 404


class TestTokenNotFound:
    """Test error handling for non-existent tokens."""

    @pytest.mark.asyncio
    async def test_ongoing_save_token_not_found(self, client: AsyncClient):
        """Test ongoing save with non-existent token."""
        response = await client.post(
            "/api/combat/ongoing-save",
            json={
                "token_id": 99999,
                "effect_id": "some_effect",
                "campaign_id": 1,
                "roll_result": 15
            }
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_escape_attempt_token_not_found(self, client: AsyncClient):
        """Test escape attempt with non-existent token."""
        response = await client.post(
            "/api/combat/escape-attempt",
            json={
                "token_id": 99999,
                "effect_id": "some_effect",
                "campaign_id": 1,
                "roll_result": 15
            }
        )
        assert response.status_code == 404


class _ResolverTestDB:
    def __init__(self, tokens_by_id: dict[int, object]):
        self.tokens_by_id = tokens_by_id

    async def get(self, _model, token_id: int):
        return self.tokens_by_id.get(token_id)

    async def flush(self):
        return None


class _ZoneSpellSettleTestDB(_ResolverTestDB):
    def __init__(self, tokens_by_id: dict[int, object]):
        super().__init__(tokens_by_id)
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None


def _build_spell_resolver_context() -> SpellContext:
    return SpellContext(
        caster_token_id=101,
        caster_name="施法者",
        caster_level=5,
        spellcasting_mod=4,
        proficiency_bonus=3,
        spell_save_dc=15,
        spell_attack_bonus=7,
        slot_level=2,
        spell_id="hold-person",
        spell_name="人类定身术",
        concentration=True,
        campaign_id=1,
        in_combat=True,
    )


class TestCleanupCasterConcentrationAreaEffect:
    @pytest.mark.asyncio
    async def test_area_effect_keeps_concentration_when_last_target_removed(self, monkeypatch):
        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        monkeypatch.setattr(combat, "flag_modified", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)

        caster = SimpleNamespace(
            id=101,
            concentration_spell={
                "spell_id": "stinking-cloud",
                "spell_name": "臭云术",
                "affected_token_ids": [202],
                "area_effect": {
                    "shape": "sphere",
                    "center_x": 10,
                    "center_y": 12,
                    "radius": 20,
                    "map_url": "test-map",
                },
            },
        )
        db = _ResolverTestDB({caster.id: caster})

        await combat._cleanup_caster_concentration(
            db,
            {
                "id": "stinking_cloud_poisoned",
                "source_token_id": caster.id,
                "spell_id": "stinking-cloud",
            },
            target_token_id=202,
            campaign_id=1,
        )

        assert caster.concentration_spell is not None
        assert caster.concentration_spell["spell_id"] == "stinking-cloud"
        assert caster.concentration_spell["affected_token_ids"] == []
        assert caster.concentration_spell["area_effect"]["radius"] == 20

        assert [item["message"]["type"] for item in broadcasts] == ["token_concentration_update"]
        assert broadcasts[0]["message"]["token_id"] == caster.id
        assert broadcasts[0]["message"]["concentration_spell"]["affected_token_ids"] == []


class TestZoneSpellSettleAreaConcentrationTracking:
    @pytest.mark.asyncio
    async def test_zone_settle_readds_target_without_duplicate_entries(self, monkeypatch):
        import app.utils.rules_cache as rules_cache

        broadcasts = []

        async def _capture(message, campaign_id, exclude=None):
            broadcasts.append({"message": message, "campaign_id": campaign_id})

        from app.services.effect_engine.handlers import condition as condition_handler

        monkeypatch.setattr(combat, "flag_modified", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(condition_handler, "flag_modified", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(combat.random, "randint", lambda _a, _b: 5)
        monkeypatch.setattr(combat.manager, "broadcast_to_campaign", _capture)

        async def _fake_resolve(_db, _campaign_id, current_user):
            return SimpleNamespace(
                campaign_id=_campaign_id,
                user_id=str(current_user.get("user_id", "tester")),
                role="dm",
                selected_character_id=None,
                campaign=None,
                membership=None,
                is_dm=True,
                is_admin=False,
            )

        monkeypatch.setattr(combat, "resolve_campaign_member_context", _fake_resolve)
        monkeypatch.setattr(
            rules_cache,
            "get_spell_by_id",
            lambda _spell_id: {
                "saveType": "con",
                "saveTypeCn": "体质",
                "school": "conjuration",
                "controlEffect": {
                    "condition": "poisoned",
                    "conditionCn": "中毒",
                    "ongoingSave": {"timing": "end_of_turn", "saveType": "con"},
                },
                "effects": [
                    {
                        "trigger": "end_of_target_turn",
                        "target": {"type": "single"},
                        "save": {"ability": "con", "on_success": "no_effect"},
                        "effects": [
                            {
                                "type": "apply_condition",
                                "condition": "poisoned",
                                "condition_cn": "中毒",
                            }
                        ],
                    }
                ],
            },
        )

        caster = SimpleNamespace(
            id=101,
            instance_name="施法者",
            concentration_spell={
                "spell_id": "stinking-cloud",
                "spell_name": "臭云术",
                "affected_token_ids": [],
                "area_effect": {
                    "shape": "sphere",
                    "center_x": 10,
                    "center_y": 12,
                    "radius": 20,
                    "map_url": "test-map",
                },
            },
            active_effects=[],
            character_id=None,
            monster_instance_id=None,
            current_hp=20,
            status_effects=[],
        )
        target = SimpleNamespace(
            id=202,
            instance_name="目标",
            active_effects=[],
            character_id=None,
            monster_instance_id=None,
            current_hp=20,
            status_effects=[],
        )
        db = _ZoneSpellSettleTestDB({caster.id: caster, target.id: target})
        request = combat.ZoneSpellSettleRequest(
            campaign_id=1,
            caster_token_id=caster.id,
            spell_id="stinking-cloud",
            target_token_ids=[target.id],
        )

        current_user = {"user_id": "tester"}
        first_result = await combat.settle_zone_spell(request, db=db, current_user=current_user)
        second_result = await combat.settle_zone_spell(request, db=db, current_user=current_user)

        assert first_result.success is True
        assert second_result.success is True
        assert caster.concentration_spell is not None
        assert caster.concentration_spell["affected_token_ids"] == [target.id]
        assert len(target.active_effects) == 1
        assert target.active_effects[0]["sourceSpell"] == "stinking-cloud"
        assert target.active_effects[0]["icon_path"] == "/assets/condition-icons/poisoned.png"

        concentration_updates = [
            item for item in broadcasts if item["message"]["type"] == "token_concentration_update"
        ]
        assert len(concentration_updates) == 1
        assert concentration_updates[0]["message"]["concentration_spell"]["affected_token_ids"] == [target.id]
