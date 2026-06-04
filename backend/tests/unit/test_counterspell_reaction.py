"""Focused tests for counterspell reaction V1.

Covers:
- ReactionResult schema gained `countered` / `interrupted_spell_name` fields.
- SpellCastResponse carries `spell_id` and `caster_token_id` for the
  frontend reaction-trigger contract.
- `use_reaction` counterspell branch clears `casting_in_progress` on the
  target caster token and publishes the interrupt.
- Counterspell branch also falls back the reactor_name when the request
  omits it.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.combat import (
    AbilityScores,
    ReactionRequest,
    ReactionResult,
)
from app.api.routes.spell_cast import SpellCastResponse
import app.api.routes.combat as combat_route


def test_reaction_result_has_counterspell_fields_with_defaults():
    r = ReactionResult(reaction_id="counterspell", reaction_name="反制法术", reactor_name="A")
    assert r.countered is False
    assert r.interrupted_spell_name is None


def test_spell_cast_response_carries_spell_id_and_caster_token_id():
    resp = SpellCastResponse(success=True, spell_id="fireball", caster_token_id=11)
    dumped = resp.model_dump()
    assert dumped["spell_id"] == "fireball"
    assert dumped["caster_token_id"] == 11


def _make_request(reactor_name: str = "") -> ReactionRequest:
    return ReactionRequest(
        campaign_id=1,
        reactor_token_id=42,
        target_token_id=99,
        reaction_id="counterspell",
        category="spell",
        spell_slot_level=3,
        reactor_name=reactor_name,
        reactor_level=5,
        reactor_ability_scores=AbilityScores(
            strength=10, dexterity=14, constitution=12,
            intelligence=16, wisdom=12, charisma=10,
        ),
        reactor_proficiency_bonus=3,
    )


@pytest.fixture
def patched_route(monkeypatch):
    """Patch the heavy dependencies inside `combat_route.use_reaction`."""
    # Auth / context
    fake_ctx = SimpleNamespace(user_id=7)
    monkeypatch.setattr(
        combat_route,
        "resolve_campaign_member_context",
        AsyncMock(return_value=fake_ctx),
    )
    monkeypatch.setattr(combat_route, "_sender_role_from_context", lambda _ctx: "player")

    # Reaction display + description helpers
    monkeypatch.setattr(
        combat_route, "reaction_display_name_service", lambda rid: "反制法术"
    )
    monkeypatch.setattr(
        combat_route,
        "build_spell_reaction_description_service",
        lambda **kwargs: f"{kwargs.get('reactor_name', '?')} 施放【反制法术】",
    )
    monkeypatch.setattr(
        combat_route,
        "build_reaction_chat_meta_service",
        lambda **kwargs: {"combat_type": "reaction", **kwargs},
    )

    # Spell slot consumption
    monkeypatch.setattr(combat_route, "_consume_spell_slot", AsyncMock())

    # Chat broadcasting
    chat_msg = SimpleNamespace(id=555, meta={})
    monkeypatch.setattr(
        combat_route,
        "create_combat_chat_message_service",
        AsyncMock(return_value=chat_msg),
    )
    monkeypatch.setattr(
        combat_route,
        "combat_chat_timestamp_ms_service",
        lambda _msg: 1700000000000,
    )

    # Realtime publishes — record calls
    publish_interrupted = AsyncMock()
    publish_chat = AsyncMock()
    publish_reaction_used = AsyncMock()
    publisher = MagicMock()
    publisher.publish_token_casting_interrupted = publish_interrupted
    publisher.publish_chat_message = publish_chat
    publisher.publish_combat_reaction_used = publish_reaction_used
    monkeypatch.setattr(combat_route, "realtime_publisher", publisher)

    # SQLAlchemy flag_modified expects a real ORM instance; tests use SimpleNamespace
    monkeypatch.setattr(combat_route, "flag_modified", lambda _obj, _attr: None)

    return {
        "publish_interrupted": publish_interrupted,
        "publish_chat": publish_chat,
        "publish_reaction_used": publish_reaction_used,
    }


class _FakeDB:
    """Minimal AsyncSession stand-in that resolves (Model, pk) lookups."""

    def __init__(self, store: dict):
        self._store = store
        self.commits = 0

    async def get(self, model, pk):  # noqa: D401
        return self._store.get((model.__name__, pk))

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_counterspell_interrupts_in_progress_cast(patched_route):
    from app.models.token import Token

    reactor_token = SimpleNamespace(
        id=42, character_id=None, instance_name="法师A",
        casting_in_progress=None,
    )
    target_token = SimpleNamespace(
        id=99, campaign_id=1, character_id=None, instance_name="法师B",
        casting_in_progress={"spell_id": "fireball", "spell_name": "火球术"},
    )
    db = _FakeDB({
        ("Token", 42): reactor_token,
        ("Token", 99): target_token,
    })

    resp = await combat_route.use_reaction(
        request=_make_request(reactor_name="法师A"),
        db=db,
        current_user={"user_id": 7},
    )

    assert resp.success is True
    assert resp.result is not None
    assert resp.result.countered is True
    assert resp.result.interrupted_spell_name == "火球术"
    # casting_in_progress cleared and interrupt broadcast fired
    assert target_token.casting_in_progress is None
    patched_route["publish_interrupted"].assert_awaited_once()
    call_kwargs = patched_route["publish_interrupted"].call_args.kwargs
    assert call_kwargs.get("reason") == "counterspell"
    assert call_kwargs.get("token_id") == 99


@pytest.mark.asyncio
async def test_counterspell_without_in_progress_records_reaction(patched_route):
    reactor_token = SimpleNamespace(
        id=42, character_id=None, instance_name="法师A",
        casting_in_progress=None,
    )
    target_token = SimpleNamespace(
        id=99, campaign_id=1, character_id=None, instance_name="法师B",
        casting_in_progress=None,
    )
    db = _FakeDB({
        ("Token", 42): reactor_token,
        ("Token", 99): target_token,
    })

    resp = await combat_route.use_reaction(
        request=_make_request(reactor_name="法师A"),
        db=db,
        current_user={"user_id": 7},
    )

    assert resp.success is True
    assert resp.result.countered is False
    assert resp.result.interrupted_spell_name is None
    # Did NOT publish an interrupt
    patched_route["publish_interrupted"].assert_not_awaited()
    # Description includes the honest "no rollback" note
    assert "已记录反制" in resp.result.description


@pytest.mark.asyncio
async def test_counterspell_fills_reactor_name_from_token(patched_route):
    reactor_token = SimpleNamespace(
        id=42, character_id=None, instance_name="法师A",
        casting_in_progress=None,
    )
    target_token = SimpleNamespace(
        id=99, campaign_id=1, character_id=None, instance_name="法师B",
        casting_in_progress=None,
    )
    db = _FakeDB({
        ("Token", 42): reactor_token,
        ("Token", 99): target_token,
    })

    resp = await combat_route.use_reaction(
        request=_make_request(reactor_name=""),
        db=db,
        current_user={"user_id": 7},
    )

    assert resp.success is True
    assert resp.result.reactor_name == "法师A"
