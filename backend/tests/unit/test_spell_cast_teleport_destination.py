"""
Unit tests for the teleport_destination bridge between
`/api/spells/cast` → `SpellResolver` → `TeleportHandler`.

The bridge is just a whitelisted phase-context merge inside
SpellResolver, so we exercise that directly without standing up
the full route + DB fixture machinery.
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.spell_resolver import SpellResolver
from app.services.effect_engine.handlers.teleport import TeleportHandler
from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)


class TestPhaseContextMerge:
    def test_merges_whitelisted_teleport_destination(self):
        resolver = SpellResolver()
        resolver._phase_context = {"teleport_destination": {"x": 12, "y": 7}}
        merged = resolver._phase_with_context({"trigger": "on_cast", "effects": []})
        assert merged["teleport_destination"] == {"x": 12, "y": 7}
        assert merged["trigger"] == "on_cast"

    def test_returns_phase_unchanged_when_no_context(self):
        resolver = SpellResolver()
        resolver._phase_context = {}
        original = {"trigger": "on_cast", "effects": []}
        merged = resolver._phase_with_context(original)
        # Identity preserved when no context — no allocation overhead.
        assert merged is original

    def test_resolve_filters_non_whitelisted_keys(self):
        """`resolve` must drop keys outside the allow-list to prevent
        route callers from injecting arbitrary phase data into handlers."""
        resolver = SpellResolver()
        # Simulate what `resolve` would do (without the async dance)
        ctx = {
            "teleport_destination": {"x": 1, "y": 2},
            "evil_payload": "should_be_dropped",
        }
        resolver._phase_context = {
            k: v for k, v in ctx.items()
            if k in SpellResolver._ALLOWED_PHASE_CONTEXT_KEYS and v is not None
        }
        assert resolver._phase_context == {"teleport_destination": {"x": 1, "y": 2}}
        assert "evil_payload" not in resolver._phase_context

    def test_resolve_drops_none_values(self):
        resolver = SpellResolver()
        ctx = {"teleport_destination": None}
        resolver._phase_context = {
            k: v for k, v in ctx.items()
            if k in SpellResolver._ALLOWED_PHASE_CONTEXT_KEYS and v is not None
        }
        assert resolver._phase_context == {}


class TestTeleportHandlerReceivesDestination:
    """Once the merged phase reaches `TeleportHandler`, it must read the
    destination and write it to the token. This protects the integration
    between SpellResolver's merge and the handler's existing read path."""

    @pytest.mark.asyncio
    async def test_handler_moves_token_from_merged_phase(self):
        resolver = SpellResolver()
        resolver._phase_context = {"teleport_destination": {"x": 99, "y": 42}}
        # Simulate what `_execute_phase` does: build a merged phase, then
        # construct HandlerContext.phase from it.
        original_phase = {
            "trigger": "on_cast",
            "target": {"type": "self"},
            "effects": [
                {"type": "teleport", "range": 30, "mode": "self", "mustSee": True},
            ],
        }
        merged_phase = resolver._phase_with_context(original_phase)

        token = MagicMock()
        token.position_x = 0
        token.position_y = 0
        token.active_effects = []

        db = AsyncMock()
        db.get = AsyncMock(return_value=token)

        source = EffectSource(
            type="spell", id="misty_step", name="迷踪步",
            caster_token_id=1, concentration=False, slot_level=2,
        )
        ctx_ns = SimpleNamespace(
            caster_token_id=1, caster_name="法师", caster_level=5,
            spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
            spell_attack_bonus=7, spell_level=2, slot_level=2,
            spell_id="misty_step", spell_name="迷踪步",
            concentration=False, campaign_id=1, in_combat=True,
            current_world_time=None,
        )
        target = SimpleNamespace(
            token_id=1, name="法师", character_id=18,
            monster_instance_id=None, condition_immunities=[],
        )
        hctx = HandlerContext(
            source=source, target=target, caster_ctx=ctx_ns,
            phase=merged_phase, db=db,
        )

        handler = TeleportHandler()
        params = handler.get_param_schema()(
            type="teleport", range=30, mode="self",
        )
        await handler.execute(params, hctx, SideEffects())

        assert token.position_x == 99
        assert token.position_y == 42
