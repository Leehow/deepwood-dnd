import pytest

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.characters import _repair_character_equipment_avatars
from app.models.character import Character
from app.models.item import Item
from app.services.avatar_service import avatar_service


@pytest.mark.asyncio
async def test_repair_character_equipment_avatar_from_item_library(
    db_session: AsyncSession,
    test_campaign,
):
    item = Item(
        campaign_id=test_campaign.id,
        name="爆弹枪子弹",
        category="ammunition",
        avatar_url="/images/items/bolter-ammo.png",
        avatar_url_large="/images/items/bolter-ammo-large.png",
        has_avatar=True,
        is_custom=True,
    )
    db_session.add(item)
    await db_session.flush()

    character = Character(
        user_id="test-user",
        name="艾莉薇特·宁叶",
        race_id="elf",
        class_id="wizard",
        level=1,
        appearance={},
        personality={},
        ability_scores={"strength": 8, "dexterity": 16, "constitution": 12, "intelligence": 16, "wisdom": 10, "charisma": 10},
        selected_skills=[],
        expertise_skills=[],
        selected_cantrips=[],
        selected_spells=[],
        prepared_spells=[],
        equipment=[{
            "id": "custom-1",
            "name": "爆弹枪子弹",
            "avatar_url": "https://dashscope-7c2c.oss-cn-shanghai.aliyuncs.com/tmp.png?Expires=1&OSSAccessKeyId=x&Signature=y",
        }],
        currency={"gp": 0, "sp": 0, "cp": 0, "ep": 0, "pp": 0},
        subclass_choices={},
        race_choices={},
    )
    db_session.add(character)
    await db_session.commit()
    await db_session.refresh(character)

    changed = await _repair_character_equipment_avatars(character, db_session)

    assert changed is True
    assert character.equipment[0]["avatar_url"] == "/images/items/bolter-ammo.png"
    assert character.equipment[0]["avatar_url_large"] == "/images/items/bolter-ammo-large.png"


@pytest.mark.asyncio
async def test_generate_equipment_avatar_updates_backing_custom_item(
    client: AsyncClient,
    db_session: AsyncSession,
    test_campaign,
    monkeypatch: pytest.MonkeyPatch,
):
    item = Item(
        campaign_id=test_campaign.id,
        name="链锯剑",
        category="weapon",
        avatar_url="/images/items/old-chainsword.png",
        avatar_url_large="/images/items/old-chainsword-large.png",
        has_avatar=True,
        is_custom=True,
    )
    db_session.add(item)
    await db_session.flush()

    character = Character(
        user_id="test-user",
        name="艾莉薇特·宁叶",
        race_id="elf",
        class_id="wizard",
        level=1,
        appearance={},
        personality={},
        ability_scores={"strength": 8, "dexterity": 16, "constitution": 12, "intelligence": 16, "wisdom": 10, "charisma": 10},
        selected_skills=[],
        expertise_skills=[],
        selected_cantrips=[],
        selected_spells=[],
        prepared_spells=[],
        equipment=[{
            "id": "custom-2",
            "name": "链锯剑",
            "description": "嗡鸣作响的链锯剑",
            "libraryItemId": item.id,
            "avatar_url": "/images/items/old-chainsword.png",
        }],
        currency={"gp": 0, "sp": 0, "cp": 0, "ep": 0, "pp": 0},
        subclass_choices={},
        race_choices={},
    )
    db_session.add(character)
    await db_session.commit()
    await db_session.refresh(character)
    await db_session.refresh(item)

    captured: dict[str, int] = {}

    async def fake_generate_avatar(*args, **kwargs):
        captured["entity_id"] = kwargs["entity_id"]
        return (
            "https://cdn.example.com/items/chainsword_128.webp",
            "https://cdn.example.com/items/chainsword_512.webp",
        )

    monkeypatch.setattr(avatar_service, "generate_avatar", fake_generate_avatar)

    response = await client.post(
        f"/api/characters/{character.id}/equipment-avatar",
        json={
            "item_id": "custom-2",
            "item_name": "链锯剑",
            "item_description": "嗡鸣作响的链锯剑",
            "library_item_id": item.id,
        },
    )

    assert response.status_code == 200
    assert response.json()["avatar_url"] == "https://cdn.example.com/items/chainsword_128.webp"
    assert captured["entity_id"] == item.id

    await db_session.refresh(character)
    await db_session.refresh(item)

    assert character.equipment[0]["avatar_url"] == "https://cdn.example.com/items/chainsword_128.webp"
    assert character.equipment[0]["avatar_url_large"] == "https://cdn.example.com/items/chainsword_512.webp"
    assert character.equipment[0]["libraryItemId"] == item.id
    assert item.avatar_url == "https://cdn.example.com/items/chainsword_128.webp"
    assert item.avatar_url_large == "https://cdn.example.com/items/chainsword_512.webp"
