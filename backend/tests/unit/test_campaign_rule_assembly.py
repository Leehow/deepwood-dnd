from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.api.routes.campaigns import get_campaign_rule_options
from app.models.campaign import Campaign
from app.services.campaign_rule_assembler import CampaignRuleAssembler
from app.services.character_rule_registry import CharacterRuleRegistry


def test_registry_normalizes_base_rules_catalog() -> None:
    registry = CharacterRuleRegistry()

    package = registry.get_base_package()
    classes = {item["id"]: item for item in package["catalog"]["classes"]}
    races = {item["id"]: item for item in package["catalog"]["races"]}
    backgrounds = {item["id"]: item for item in package["catalog"]["backgrounds"]}
    deities = package["catalog"]["deities"]

    assert package["package"]["package_id"] == "official.phb"
    assert "wizard" in classes
    assert classes["wizard"]["subclass_count"] > 0
    assert "elf" in races
    assert races["elf"]["subrace_count"] > 0
    assert backgrounds
    assert "acolyte" in backgrounds
    assert deities
    assert deities[0]["pantheon_id"]


def test_assembler_prefers_new_toggle_over_legacy_toggle() -> None:
    assembler = CampaignRuleAssembler()
    campaign = Campaign(
        id=101,
        name="Toggle Test",
        dm_user_id="dm-1",
        meta={
            "enable_deity_system": True,
            "rule_assembly": {
                "rule_toggles": {
                    "deity_system": False,
                }
            },
        },
    )

    result = assembler.assemble_rule_options(campaign)

    assert result["toggles"]["deity_system"] is False
    assert result["catalog"]["deities"] == []


def test_assembler_emits_phase0_warnings_for_future_inputs() -> None:
    assembler = CampaignRuleAssembler()
    campaign = Campaign(
        id=202,
        name="Warning Test",
        dm_user_id="dm-2",
        selected_module_id="module.barovia",
        meta={
            "rule_assembly": {
                "enabled_package_ids": ["official.phb", "homebrew.table-pack"],
                "rule_toggles": {"deity_system": True},
            }
        },
    )

    result = assembler.assemble_rule_options(campaign)

    assert result["toggles"]["deity_system"] is True
    assert result["catalog"]["deities"]
    assert len(result["warnings"]) == 2
    assert "enabled_package_ids" in result["warnings"][0]
    assert "selected_module_id" in result["warnings"][1]


@pytest.mark.asyncio
async def test_rule_options_route_returns_assembled_response() -> None:
    campaign = Campaign(
        id=303,
        name="Route Test",
        dm_user_id="dm-3",
        meta={"enable_deity_system": True},
    )
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = campaign
    db.execute.return_value = result

    response = await get_campaign_rule_options(
        campaign_id=303,
        db=db,
        current_user={"user_id": "player-1"},
    )

    assert response["campaign_id"] == 303
    assert response["toggles"]["deity_system"] is True
    assert response["catalog"]["classes"]


@pytest.mark.asyncio
async def test_rule_options_route_returns_404_for_missing_campaign() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result

    with pytest.raises(HTTPException) as exc_info:
        await get_campaign_rule_options(
            campaign_id=404,
            db=db,
            current_user={"user_id": "player-1"},
        )

    assert exc_info.value.status_code == 404