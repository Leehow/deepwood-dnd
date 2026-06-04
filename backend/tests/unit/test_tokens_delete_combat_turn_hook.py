"""Route-adjacent test that ``tokens.delete_token`` dispatches the runtime
turn-trigger hook when deleting the currently active combatant.

Stage 8a wired the hook into ``campaign_storage.update_storage_object``;
Stage 8c extends that contract to ``delete_token``, which mutates the
canonical ``combat/current`` row directly. We exercise ``delete_token`` with
stubbed session + publisher + dispatcher to confirm:

  - the shared dispatcher is called once,
  - the snapshot it receives reflects the pre-mutation active combatant,
  - the new data passed in reflects the post-mutation active combatant.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.api.routes import tokens as tokens_route


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    """Minimal AsyncSession double for ``delete_token``.

    The route calls ``db.execute`` twice: first to fetch the Token row, then
    to fetch the canonical combat storage row. We dispatch by call order.
    """

    def __init__(self, token, combat_obj):
        self._results = [_ScalarResult(token), _ScalarResult(combat_obj)]
        self.commits = 0
        self.deleted = []

    async def execute(self, _stmt):
        if not self._results:
            return _ScalarResult(None)
        return self._results.pop(0)

    async def delete(self, instance):
        self.deleted.append(instance)

    async def commit(self):
        self.commits += 1


def _stub_publisher(monkeypatch):
    """Silence realtime_publisher.* awaitables used by delete_token."""

    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        tokens_route.realtime_publisher,
        "publish_combat_storage_updated",
        noop,
    )
    monkeypatch.setattr(
        tokens_route.realtime_publisher,
        "publish_map_token_removed",
        noop,
    )


def _install_hook_spy(monkeypatch):
    calls: list[dict] = []

    async def fake_hook(db, *, campaign_id, prev_data, prev_is_active, new_data, new_is_active):
        calls.append(
            {
                "campaign_id": campaign_id,
                "prev_data": prev_data,
                "prev_is_active": prev_is_active,
                "new_data": new_data,
                "new_is_active": new_is_active,
            }
        )

    # The route imports the hook by name at module load, so patch the route
    # module's binding.
    monkeypatch.setattr(
        tokens_route,
        "dispatch_combat_turn_triggers_if_changed",
        fake_hook,
    )
    return calls


def test_delete_token_dispatches_hook_for_active_combatant(monkeypatch):
    _stub_publisher(monkeypatch)
    hook_calls = _install_hook_spy(monkeypatch)

    # Token 10 is the current active combatant in (token 10, token 20).
    token = SimpleNamespace(id=10, campaign_id=7)
    combat_obj = SimpleNamespace(
        id=1,
        campaign_id=7,
        object_type="combat",
        object_id="current",
        object_name=None,
        is_active=True,
        version=4,
        data={
            "participants": [
                {"token_id": 10, "name": "A"},
                {"token_id": 20, "name": "B"},
            ],
            "order": [10, 20],
            "current_index": 0,
            "round": 1,
            "in_combat": True,
        },
    )

    db = _FakeDB(token, combat_obj)

    result = asyncio.run(
        tokens_route.delete_token(
            token_id=10,
            db=db,
            current_user={"id": "u1"},
        )
    )

    assert result == {"success": True}
    # Token deletion commit + combat-storage mutation commit = 2.
    assert db.commits == 2
    assert db.deleted == [token]

    # Hook fired exactly once with the right snapshot.
    assert len(hook_calls) == 1
    call = hook_calls[0]
    assert call["campaign_id"] == 7
    # Pre-mutation state still reports token 10 as active.
    prev_data = call["prev_data"]
    assert prev_data["order"] == [10, 20]
    assert prev_data["current_index"] == 0
    assert call["prev_is_active"] is True
    # Post-mutation state: order is just [20] with index 0 (token 20 active).
    new_data = call["new_data"]
    assert new_data["order"] == [20]
    assert new_data["current_index"] == 0
    assert call["new_is_active"] is True


def test_delete_token_dispatches_hook_when_combat_ends(monkeypatch):
    """Deleting the only combatant should still call the hook (combat ends);
    the hook itself decides to short-circuit on ``new_in_session=False``."""
    _stub_publisher(monkeypatch)
    hook_calls = _install_hook_spy(monkeypatch)

    token = SimpleNamespace(id=10, campaign_id=7)
    combat_obj = SimpleNamespace(
        id=1,
        campaign_id=7,
        object_type="combat",
        object_id="current",
        object_name=None,
        is_active=True,
        version=2,
        data={
            "participants": [{"token_id": 10, "name": "A"}],
            "order": [10],
            "current_index": 0,
            "round": 1,
            "in_combat": True,
        },
    )

    db = _FakeDB(token, combat_obj)
    asyncio.run(
        tokens_route.delete_token(
            token_id=10,
            db=db,
            current_user={"id": "u1"},
        )
    )

    assert len(hook_calls) == 1
    call = hook_calls[0]
    assert call["new_data"]["order"] == []
    # Route flips is_active to False when no combatants remain.
    assert call["new_is_active"] is False
    assert call["prev_is_active"] is True


def test_delete_token_skips_hook_when_token_not_in_combat(monkeypatch):
    _stub_publisher(monkeypatch)
    hook_calls = _install_hook_spy(monkeypatch)

    token = SimpleNamespace(id=99, campaign_id=7)
    combat_obj = SimpleNamespace(
        id=1,
        campaign_id=7,
        object_type="combat",
        object_id="current",
        object_name=None,
        is_active=True,
        version=2,
        data={
            "participants": [{"token_id": 10, "name": "A"}],
            "order": [10],
            "current_index": 0,
            "round": 1,
            "in_combat": True,
        },
    )

    db = _FakeDB(token, combat_obj)
    asyncio.run(
        tokens_route.delete_token(
            token_id=99,
            db=db,
            current_user={"id": "u1"},
        )
    )

    # Token wasn't in combat order, so neither the storage commit nor the
    # hook should fire.
    assert hook_calls == []
    assert db.commits == 1  # only the initial token-delete commit
