"""RT-1 tests for the single world-time settlement owner.

Two layers:
  * service composition/order/flags: the four settlement primitives are
    mocked; we assert order, argument forwarding, and that opt-out flags skip
    steps (the HTTP-subset / no-double-settlement guarantee).
  * boundary + idempotency: exercises the real cleanup_campaign_effect_durations
    against a fake DB to prove an effect survives before its expiry, is removed
    exactly once at expiry, and a repeat pass at the same world-time is a no-op.
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.world_time_settlement import settle_world_time

CID = 7
NOW = {"day": 1, "hour": 0, "minute": 0, "second": 0}


def _patch_primitives(recorder):
    """Patch the four settlement primitives at their source modules (they are
    imported lazily inside settle_world_time) and record call order."""

    async def _due(db, cid, ct):
        recorder.append("due_casts")
        return [{"token_id": 1, "spell_id": "x"}]

    async def _eff(db, *, campaign_id, current_time, rounds, map_url):
        recorder.append(("effect_durations", rounds, map_url))
        return {"success": True, "updated_count": 0, "updates": []}

    async def _conc(db, *, campaign_id, current_time):
        recorder.append("concentration")
        return [11]

    async def _runtime(db, *, campaign_id, current_world_time):
        recorder.append("runtime_instances")
        return [22]

    return [
        patch("app.api.routes.spell_cast.resolve_due_casts_for_campaign", side_effect=_due),
        patch("app.api.routes.tokens.cleanup_campaign_effect_durations", side_effect=_eff),
        patch("app.api.routes.tokens.cleanup_expired_concentration_for_campaign", side_effect=_conc),
        patch("app.services.spell_runtime_service.cleanup_expired_runtime_instances", side_effect=_runtime),
    ]


class TestSettlementComposition:

    @pytest.mark.asyncio
    async def test_full_settlement_runs_all_steps_in_order(self):
        recorder = []
        patches = _patch_primitives(recorder)
        for p in patches:
            p.start()
        try:
            result = await settle_world_time(AsyncMock(), CID, NOW, rounds=0, source="time_update")
        finally:
            for p in patches:
                p.stop()

        assert [r if isinstance(r, str) else r[0] for r in recorder] == [
            "due_casts", "effect_durations", "concentration", "runtime_instances",
        ]
        assert result.steps_run == [
            "due_casts", "effect_durations", "concentration", "runtime_instances",
        ]
        assert result.expired_concentration_token_ids == [11]
        assert result.ended_runtime_token_ids == [22]
        # WS path settles world time only (no legacy per-round decrement).
        eff_call = next(r for r in recorder if isinstance(r, tuple))
        assert eff_call == ("effect_durations", 0, None)

    @pytest.mark.asyncio
    async def test_http_subset_skips_concentration_and_runtime(self):
        """The compatibility HTTP endpoint runs ONLY the token effect step, so a
        single top-bar advance does not settle concentration/runtime twice."""
        recorder = []
        patches = _patch_primitives(recorder)
        for p in patches:
            p.start()
        try:
            result = await settle_world_time(
                AsyncMock(), CID, NOW,
                rounds=1, map_url="map://a", source="http_decrement",
                settle_due_casts=False,
                settle_effect_durations=True,
                settle_concentration=False,
                settle_runtime_instances=False,
            )
        finally:
            for p in patches:
                p.stop()

        assert result.steps_run == ["effect_durations"]
        assert "due_casts" not in recorder
        assert "concentration" not in recorder
        assert "runtime_instances" not in recorder
        eff_call = next(r for r in recorder if isinstance(r, tuple))
        assert eff_call == ("effect_durations", 1, "map://a")


# --- Boundary + idempotency against the real cleanup function ---

class _Result:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


def _expiring_token():
    return SimpleNamespace(
        id=10,
        campaign_id=CID,
        map_url=None,
        character_id=None,
        monster_instance_id=None,
        disguise_data=None,
        active_auras=None,
        active_effects=[{
            "id": "guiding_bolt_buff",
            "name": "guiding bolt",
            "spell_id": "guiding_bolt",
            "spell_buff": True,
            "duration": 1,
            "expires_at": {"day": 1, "hour": 0, "minute": 0, "second": 6},
            "modifiers": [{"target": "attack", "type": "advantage"}],
        }],
    )


async def _run_cleanup(token, current_time):
    from app.api.routes import tokens as tokens_mod

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result([token]))
    db.commit = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with patch.object(tokens_mod, "realtime_publisher", AsyncMock()), \
         patch.object(tokens_mod, "aura_service", AsyncMock()), \
         patch("app.utils.spell_item_cleanup.cleanup_spell_generated_items", AsyncMock()):
        return await tokens_mod.cleanup_campaign_effect_durations(
            db, campaign_id=CID, current_time=current_time, rounds=0, map_url=None,
        )


class TestBoundaryCleanup:

    @pytest.mark.asyncio
    async def test_remains_before_expiry(self):
        token = _expiring_token()
        res = await _run_cleanup(token, {"day": 1, "hour": 0, "minute": 0, "second": 0})
        assert res["updated_count"] == 0
        assert len(token.active_effects) == 1

    @pytest.mark.asyncio
    async def test_removed_exactly_once_at_expiry(self):
        token = _expiring_token()
        at_expiry = {"day": 1, "hour": 0, "minute": 0, "second": 6}

        res1 = await _run_cleanup(token, at_expiry)
        assert res1["updated_count"] == 1
        assert token.active_effects in (None, [])

        # Idempotent: a second pass at the same world time removes nothing more.
        res2 = await _run_cleanup(token, at_expiry)
        assert res2["updated_count"] == 0
