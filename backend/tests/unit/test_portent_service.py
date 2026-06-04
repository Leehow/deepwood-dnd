"""Tests for portent_service — 预言骰"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.services.portent_service import (
    roll_portent_dice,
    use_portent_die,
    get_portent_values,
    _portent_count,
)


def _make_char(class_id="wizard", subclass_id="divination", level=2, uses=None):
    char = MagicMock()
    char.class_id = class_id
    char.subclass_id = subclass_id
    char.level = level
    char.class_feature_uses = uses or {}
    return char


class TestPortentCount:
    def test_level_2_gives_2(self):
        assert _portent_count(2) == 2

    def test_level_13_gives_2(self):
        assert _portent_count(13) == 2

    def test_level_14_gives_3(self):
        assert _portent_count(14) == 3

    def test_level_20_gives_3(self):
        assert _portent_count(20) == 3


@pytest.mark.asyncio
async def test_roll_portent_dice_stores_values():
    char = _make_char(level=5)
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)
    db.flush = AsyncMock()

    values = await roll_portent_dice(db, character_id=1)

    assert len(values) == 2
    assert all(1 <= v <= 20 for v in values)
    assert values == sorted(values)
    assert char.class_feature_uses["portent"]["current"] == 2
    assert char.class_feature_uses["portent"]["max"] == 2
    assert char.class_feature_uses["portent"]["prerolledValues"] == values


@pytest.mark.asyncio
async def test_roll_portent_dice_level_14_gets_3():
    char = _make_char(level=14)
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)
    db.flush = AsyncMock()

    values = await roll_portent_dice(db, character_id=1)
    assert len(values) == 3


@pytest.mark.asyncio
async def test_roll_portent_dice_non_wizard_returns_empty():
    char = _make_char(class_id="fighter")
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)

    values = await roll_portent_dice(db, character_id=1)
    assert values == []


@pytest.mark.asyncio
async def test_roll_portent_dice_wrong_subclass_returns_empty():
    char = _make_char(subclass_id="evocation")
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)

    values = await roll_portent_dice(db, character_id=1)
    assert values == []


@pytest.mark.asyncio
async def test_use_portent_die_removes_value():
    char = _make_char(uses={
        "portent": {"current": 2, "max": 2, "prerolledValues": [7, 15]},
    })
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)
    db.flush = AsyncMock()

    remaining = await use_portent_die(db, character_id=1, value=7)
    assert remaining == [15]
    assert char.class_feature_uses["portent"]["current"] == 1


@pytest.mark.asyncio
async def test_use_portent_die_nonexistent_returns_none():
    char = _make_char(uses={
        "portent": {"current": 2, "max": 2, "prerolledValues": [7, 15]},
    })
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)

    remaining = await use_portent_die(db, character_id=1, value=3)
    assert remaining is None


@pytest.mark.asyncio
async def test_get_portent_values():
    char = _make_char(uses={
        "portent": {"current": 2, "max": 2, "prerolledValues": [4, 18]},
    })
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)

    values = await get_portent_values(db, character_id=1)
    assert values == [4, 18]


@pytest.mark.asyncio
async def test_get_portent_values_no_data():
    char = _make_char(uses={})
    db = AsyncMock()
    db.get = AsyncMock(return_value=char)

    values = await get_portent_values(db, character_id=1)
    assert values == []
