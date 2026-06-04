"""RT-4 regression tests: the QA arena snapshot is a semantic oracle.

Raw active_effects stay visible while effective_active_effects and
expired_active_effects split that raw list at the campaign's current world
time. The snapshot test stubs the session so it stays fast with --noconftest.
"""
from typing import Any

import pytest

from app.services.qa import arena_service as A


def _expires(day=1, hour=0, minute=0, second=0):
    return {"day": day, "hour": hour, "minute": minute, "second": second}


def test_world_time_to_seconds_matches_formula() -> None:
    assert A._world_time_to_seconds(_expires(day=1, hour=0, minute=0, second=0)) == 86400
    assert A._world_time_to_seconds(_expires(day=1, hour=0, minute=0, second=6)) == 86406


def test_effect_with_no_world_time_is_effective() -> None:
    assert A._effect_is_expired({"expires_at": _expires(second=6)}, None) is False


def test_effect_expired_when_current_reached_expiry() -> None:
    cur = A._world_time_to_seconds(_expires(second=6))
    assert A._effect_is_expired({"expires_at": _expires(second=6)}, cur) is True
    assert A._effect_is_expired({"expires_at": _expires(second=12)}, cur) is False


def test_effect_without_expires_at_stays_effective() -> None:
    cur = A._world_time_to_seconds(_expires(second=600))
    assert A._effect_is_expired({"name": "tracer"}, cur) is False
    assert A._effect_is_expired({"duration": 3}, cur) is False


def test_malformed_or_day_unit_effect_stays_effective() -> None:
    cur = A._world_time_to_seconds(_expires(second=600))
    assert A._effect_is_expired({"expires_at": "not-a-dict"}, cur) is False
    assert A._effect_is_expired({"expires_at": None}, cur) is False
    day_unit_effect = {"expires_at": _expires(second=0), "duration_unit": "day"}
    assert A._effect_is_expired(day_unit_effect, cur) is False
    assert A._effect_is_expired("not-an-effect", cur) is False  # type: ignore[arg-type]


class _FakeCampaign:
    def __init__(self, meta: dict[str, Any]) -> None:
        self.meta = meta


class _FakeToken:
    def __init__(self, **kw: Any) -> None:
        self.id = kw.get("id", 1)
        self.instance_name = kw.get("instance_name", "tok")
        self.character_id = kw.get("character_id")
        self.monster_instance_id = kw.get("monster_instance_id")
        self.current_hp = kw.get("current_hp", 10)
        self.temp_hp = kw.get("temp_hp", 0)
        self.position_x = kw.get("position_x", 0)
        self.position_y = kw.get("position_y", 0)
        self.active_effects = kw.get("active_effects")
        self.active_auras = kw.get("active_auras")
        self.faction = kw.get("faction", "enemy")


class _FakeScalarResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _FakeDB:
    """Returns campaign, then token rows, then monster rows."""

    def __init__(self, campaign: Any, tokens: list[Any], monsters: list[Any]) -> None:
        self._campaign = campaign
        self._scalar_queue = [tokens, monsters]

    async def get(self, _model: Any, _pk: Any) -> Any:
        return self._campaign

    async def scalars(self, _query: Any) -> _FakeScalarResult:
        return _FakeScalarResult(self._scalar_queue.pop(0))


@pytest.mark.asyncio
async def test_snapshot_splits_effective_and_expired_but_keeps_raw() -> None:
    meta = {"time_of_day": _expires(second=12)}
    expired_effect = {"name": "tracer", "expires_at": _expires(second=6)}
    live_effect = {"name": "bless", "expires_at": _expires(second=60)}
    no_expiry_effect = {"name": "manual", "duration": 5}
    token = _FakeToken(active_effects=[expired_effect, live_effect, no_expiry_effect])

    db = _FakeDB(_FakeCampaign(meta), [token], [])
    snap = await A.snapshot_arena(db, campaign_id=42)  # type: ignore[arg-type]

    assert snap["current_world_time"] == _expires(second=12)
    row = snap["tokens"][0]
    assert row["active_effects"] == [expired_effect, live_effect, no_expiry_effect]
    assert row["expired_active_effects"] == [expired_effect]
    assert row["effective_active_effects"] == [live_effect, no_expiry_effect]


@pytest.mark.asyncio
async def test_snapshot_without_world_time_treats_all_as_effective() -> None:
    token = _FakeToken(active_effects=[{"name": "x", "expires_at": _expires(second=6)}])
    db = _FakeDB(_FakeCampaign({}), [token], [])
    snap = await A.snapshot_arena(db, campaign_id=7)  # type: ignore[arg-type]

    assert snap["current_world_time"] is None
    row = snap["tokens"][0]
    assert row["expired_active_effects"] == []
    assert row["effective_active_effects"] == row["active_effects"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_tod",
    [
        {"day": "abc"},
        {"hour": None},
        {"day": float("nan")},
        {"second": float("inf")},
    ],
)
async def test_snapshot_malformed_world_time_does_not_crash(bad_tod: dict[str, Any]) -> None:
    effect = {"name": "x", "expires_at": _expires(second=6)}
    token = _FakeToken(active_effects=[effect])
    db = _FakeDB(_FakeCampaign({"time_of_day": bad_tod}), [token], [])

    snap = await A.snapshot_arena(db, campaign_id=9)  # type: ignore[arg-type]

    assert snap["current_world_time"] == bad_tod
    row = snap["tokens"][0]
    assert row["active_effects"] == [effect]
    assert row["expired_active_effects"] == []
    assert row["effective_active_effects"] == [effect]


@pytest.mark.asyncio
async def test_snapshot_non_dict_world_time_is_ignored() -> None:
    effect = {"name": "x", "expires_at": _expires(second=6)}
    token = _FakeToken(active_effects=[effect])
    db = _FakeDB(_FakeCampaign({"time_of_day": "not-a-dict"}), [token], [])

    snap = await A.snapshot_arena(db, campaign_id=11)  # type: ignore[arg-type]

    assert snap["current_world_time"] is None
    row = snap["tokens"][0]
    assert row["effective_active_effects"] == [effect]
    assert row["expired_active_effects"] == []
