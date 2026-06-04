import asyncio
from typing import Any

import pytest

from app.services.websocket_handlers import time_handler as time_handler_module
from app.services.websocket_handlers.time_handler import TimeHandler


@pytest.mark.asyncio
async def test_time_sync_commits_after_all_expected_users_ack(monkeypatch: pytest.MonkeyPatch) -> None:
    handler = TimeHandler()
    sent_messages: list[tuple[dict[str, Any], str, list[str]]] = []

    monkeypatch.setattr(
        time_handler_module.manager,
        "get_online_users",
        lambda _campaign_id: ["dm", "p1", "p2"],
    )

    async def _fake_send_to_users(message: dict[str, Any], campaign_id: str, user_ids: list[str]) -> None:
        sent_messages.append((message, campaign_id, user_ids))

    monkeypatch.setattr(time_handler_module.manager, "send_to_users", _fake_send_to_users)

    await handler._start_time_sync_session("42", sync_seq=7, dm_user_id="dm")
    assert sent_messages == []

    await handler._handle_time_update_ack({"data": {"sync_seq": 7}}, "42", "p1")
    assert sent_messages == []

    await handler._handle_time_update_ack({"data": {"sync_seq": 7}}, "42", "p2")
    assert len(sent_messages) == 1
    message, campaign_id, user_ids = sent_messages[0]
    assert campaign_id == "42"
    assert user_ids == ["dm"]
    assert message["type"] == "time_update_committed"
    assert message["data"]["sync_seq"] == 7
    assert message["data"]["reason"] == "all_acked"
    assert message["data"]["pending_user_ids"] == []


@pytest.mark.asyncio
async def test_time_sync_commits_on_timeout_when_some_users_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    handler = TimeHandler()
    sent_messages: list[tuple[dict[str, Any], str, list[str]]] = []

    monkeypatch.setattr(time_handler_module, "SYNC_ACK_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(
        time_handler_module.manager,
        "get_online_users",
        lambda _campaign_id: ["dm", "p1", "p2"],
    )

    async def _fake_send_to_users(message: dict[str, Any], campaign_id: str, user_ids: list[str]) -> None:
        sent_messages.append((message, campaign_id, user_ids))

    monkeypatch.setattr(time_handler_module.manager, "send_to_users", _fake_send_to_users)

    await handler._start_time_sync_session("99", sync_seq=3, dm_user_id="dm")
    await handler._handle_time_update_ack({"data": {"sync_seq": 3}}, "99", "p1")
    await asyncio.sleep(0.05)

    assert len(sent_messages) == 1
    message, campaign_id, user_ids = sent_messages[0]
    assert campaign_id == "99"
    assert user_ids == ["dm"]
    assert message["type"] == "time_update_committed"
    assert message["data"]["reason"] == "timeout"
    assert message["data"]["pending_user_ids"] == ["p2"]


@pytest.mark.asyncio
async def test_time_sync_commits_immediately_when_only_dm_online(monkeypatch: pytest.MonkeyPatch) -> None:
    handler = TimeHandler()
    sent_messages: list[tuple[dict[str, Any], str, list[str]]] = []

    monkeypatch.setattr(
        time_handler_module.manager,
        "get_online_users",
        lambda _campaign_id: ["dm"],
    )

    async def _fake_send_to_users(message: dict[str, Any], campaign_id: str, user_ids: list[str]) -> None:
        sent_messages.append((message, campaign_id, user_ids))

    monkeypatch.setattr(time_handler_module.manager, "send_to_users", _fake_send_to_users)

    await handler._start_time_sync_session("77", sync_seq=1, dm_user_id="dm")

    assert len(sent_messages) == 1
    message, campaign_id, user_ids = sent_messages[0]
    assert campaign_id == "77"
    assert user_ids == ["dm"]
    assert message["type"] == "time_update_committed"
    assert message["data"]["reason"] == "all_acked"
    assert message["data"]["pending_user_ids"] == []


@pytest.mark.asyncio
async def test_time_sync_commits_when_pending_user_disconnects(monkeypatch: pytest.MonkeyPatch) -> None:
    handler = TimeHandler()
    sent_messages: list[tuple[dict[str, Any], str, list[str]]] = []

    monkeypatch.setattr(
        time_handler_module.manager,
        "get_online_users",
        lambda _campaign_id: ["dm", "p1"],
    )

    async def _fake_send_to_users(message: dict[str, Any], campaign_id: str, user_ids: list[str]) -> None:
        sent_messages.append((message, campaign_id, user_ids))

    monkeypatch.setattr(time_handler_module.manager, "send_to_users", _fake_send_to_users)

    await handler._start_time_sync_session("55", sync_seq=8, dm_user_id="dm")
    await handler.handle_user_disconnected("55", "p1", "player")

    assert len(sent_messages) == 1
    message, campaign_id, user_ids = sent_messages[0]
    assert campaign_id == "55"
    assert user_ids == ["dm"]
    assert message["type"] == "time_update_committed"
    assert message["data"]["reason"] == "disconnect"
    assert message["data"]["pending_user_ids"] == []


@pytest.mark.asyncio
async def test_handle_delegates_world_time_settlement(monkeypatch: pytest.MonkeyPatch) -> None:
    """TimeHandler persists campaign time then delegates all time-bound rule
    settlement to the single owner settle_world_time. It must call it once with
    the persisted world time, rounds=0, map_url=None, source='time_update'."""
    handler = TimeHandler()
    settle_calls: list[dict[str, Any]] = []
    broadcasted: list[dict[str, Any]] = []

    class _FakeCampaign:
        def __init__(self) -> None:
            self.meta: dict[str, Any] = {}

    class _FakeResult:
        def __init__(self, value: Any) -> None:
            self._value = value

        def scalar_one_or_none(self) -> Any:
            return self._value

    class _FakeDB:
        def __init__(self) -> None:
            self.campaign = _FakeCampaign()
            self.commit_count = 0

        async def execute(self, _query: Any) -> _FakeResult:
            return _FakeResult(self.campaign)

        async def commit(self) -> None:
            self.commit_count += 1

    async def _record_settle(
        db: Any,
        campaign_id: int,
        current_time: dict[str, Any],
        *,
        map_url: str | None = None,
        rounds: int = 0,
        source: str = "time_update",
        **kwargs: Any,
    ) -> None:
        settle_calls.append(
            {
                "campaign_id": campaign_id,
                "current_time": current_time,
                "map_url": map_url,
                "rounds": rounds,
                "source": source,
            }
        )

    async def _fake_broadcast_to_campaign(message: dict[str, Any], campaign_id: str) -> None:
        broadcasted.append({"message": message, "campaign_id": campaign_id})

    monkeypatch.setattr(time_handler_module, "settle_world_time", _record_settle)
    monkeypatch.setattr(time_handler_module, "flag_modified", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(handler, "broadcast_to_campaign", _fake_broadcast_to_campaign)

    fake_db = _FakeDB()
    await handler.handle(
        {
            "type": "time_update",
            "data": {
                "day": 123,
                "hour": 14,
                "minute": 5,
                "second": 12,
                "cycle": "day",
                "realTimeActive": True,
                "environment": "normal",
            },
        },
        websocket=None,  # type: ignore[arg-type]
        campaign_id="42",
        user_id="dm-user",
        role="dm",
        db=fake_db,  # type: ignore[arg-type]
    )

    assert fake_db.commit_count == 1
    assert len(settle_calls) == 1
    call = settle_calls[0]
    assert call["campaign_id"] == 42
    assert call["rounds"] == 0
    assert call["map_url"] is None
    assert call["source"] == "time_update"
    assert call["current_time"]["day"] == 123
    assert call["current_time"]["hour"] == 14
    assert broadcasted[0]["campaign_id"] == "42"
    assert broadcasted[0]["message"]["type"] == "time_update"


class _FakeCampaign:
    def __init__(self) -> None:
        self.meta: dict[str, Any] = {}


class _FakeSettleResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value


class _FakeSettleDB:
    def __init__(self) -> None:
        self.campaign = _FakeCampaign()

    async def execute(self, _query: Any) -> _FakeSettleResult:
        return _FakeSettleResult(self.campaign)

    async def commit(self) -> None:
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "data_extra,expected_rounds",
    [
        ({"settlement_rounds": 1}, 1),             # canonical field forwarded
        ({"settlement_rounds": 8}, 8),             # rest-sized advance forwarded
        ({"advance_rounds": 3}, 3),                # compatibility alias forwarded
        ({}, 0),                                   # absent -> 0 (wall-clock only)
        ({"settlement_rounds": 0}, 0),             # explicit zero
        ({"settlement_rounds": -5}, 0),            # negative -> 0
        ({"settlement_rounds": True}, 0),          # bool -> 0 (never round count)
        ({"settlement_rounds": None}, 0),          # None -> 0
        ({"settlement_rounds": "abc"}, 0),         # non-numeric -> 0
        ({"settlement_rounds": float("nan")}, 0),  # NaN-like -> 0
        ({"settlement_rounds": float("inf")}, 0),  # inf -> 0
    ],
)
async def test_handle_forwards_settlement_rounds(
    monkeypatch: pytest.MonkeyPatch, data_extra: dict[str, Any], expected_rounds: int
) -> None:
    """Settlement-round metadata is forwarded but not persisted or broadcast."""
    handler = TimeHandler()
    settle_calls: list[dict[str, Any]] = []
    broadcasted: list[dict[str, Any]] = []

    async def _record_settle(
        db: Any,
        campaign_id: int,
        current_time: dict[str, Any],
        *,
        map_url: str | None = None,
        rounds: int = 0,
        source: str = "time_update",
        **kwargs: Any,
    ) -> None:
        settle_calls.append({"rounds": rounds})

    async def _fake_broadcast(message: dict[str, Any], campaign_id: str) -> None:
        broadcasted.append({"message": message, "campaign_id": campaign_id})

    monkeypatch.setattr(time_handler_module, "settle_world_time", _record_settle)
    monkeypatch.setattr(time_handler_module, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(handler, "broadcast_to_campaign", _fake_broadcast)

    data = {"day": 1, "hour": 0, "minute": 0, "second": 0, "cycle": "day"}
    data.update(data_extra)
    db = _FakeSettleDB()

    await handler.handle(
        {"type": "time_update", "data": data},
        websocket=None,  # type: ignore[arg-type]
        campaign_id="42",
        user_id="dm-user",
        role="dm",
        db=db,  # type: ignore[arg-type]
    )

    assert len(settle_calls) == 1
    assert settle_calls[0]["rounds"] == expected_rounds
    assert "settlement_rounds" not in db.campaign.meta["time_of_day"]
    assert "advance_rounds" not in db.campaign.meta["time_of_day"]
    assert "settlement_rounds" not in broadcasted[0]["message"]["data"]
    assert "advance_rounds" not in broadcasted[0]["message"]["data"]


def test_parse_settlement_rounds_table() -> None:
    """Pure-function coverage of the parser, independent of handle() plumbing."""
    p = TimeHandler._parse_settlement_rounds
    assert p({"settlement_rounds": 1}) == 1
    assert p({"settlement_rounds": 8}) == 8
    assert p({"advance_rounds": 3}) == 3
    assert p({"settlement_rounds": "2"}) == 2
    assert p({}) == 0
    assert p({"settlement_rounds": 0}) == 0
    assert p({"settlement_rounds": -5}) == 0
    assert p({"settlement_rounds": True}) == 0
    assert p({"settlement_rounds": False}) == 0
    assert p({"settlement_rounds": None}) == 0
    assert p({"settlement_rounds": "abc"}) == 0
    assert p({"settlement_rounds": float("nan")}) == 0
    assert p({"settlement_rounds": float("inf")}) == 0
    assert p({"settlement_rounds": 4, "advance_rounds": 9}) == 4
