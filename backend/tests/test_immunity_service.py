"""
Tests for Immunity Service
"""

import pytest
from app.services.immunity_service import (
    get_character_immunities,
    get_monster_immunities,
    check_damage_immunity,
    check_condition_immunity,
    get_race_immunities,
    get_class_immunities,
    get_saving_throw_advantage,
)


class TestRaceImmunities:
    """Test race-based immunities"""

    def test_elf_sleep_immunity(self):
        """Elves are immune to magical sleep"""
        immunities = get_race_immunities("elf")
        assert "sleep" in immunities["condition_immunities"]

        # Check source is recorded
        sleep_source = next(
            (s for s in immunities["sources"] if s["immunity"] == "sleep"),
            None
        )
        assert sleep_source is not None
        assert sleep_source["name"] == "精类血统"

    def test_elf_charmed_advantage(self):
        """Elves have advantage on saves against being charmed"""
        immunities = get_race_immunities("elf")
        assert "charmed" in immunities.get("saving_throw_advantage", [])

    def test_half_elf_fey_ancestry(self):
        """Half-elves also have Fey Ancestry"""
        immunities = get_race_immunities("half_elf")
        assert "sleep" in immunities["condition_immunities"]
        assert "charmed" in immunities.get("saving_throw_advantage", [])

    def test_chinese_race_names(self):
        """Chinese race names should also work"""
        immunities = get_race_immunities("精灵")
        assert "sleep" in immunities["condition_immunities"]

    def test_warforged_immunities(self):
        """Warforged are immune to poison and disease"""
        immunities = get_race_immunities("warforged")
        assert "poisoned" in immunities["condition_immunities"]
        assert "diseased" in immunities["condition_immunities"]
        assert "poison" in immunities["damage_immunities"]

    def test_unknown_race(self):
        """Unknown races should return empty immunities"""
        immunities = get_race_immunities("human")
        assert len(immunities["condition_immunities"]) == 0
        assert len(immunities["damage_immunities"]) == 0


class TestClassImmunities:
    """Test class-based immunities"""

    def test_paladin_divine_health(self):
        """Paladins at level 3+ are immune to disease"""
        # Level 2 - no immunity yet
        immunities_lv2 = get_class_immunities("paladin", 2)
        assert "diseased" not in immunities_lv2["condition_immunities"]

        # Level 3 - gains Divine Health
        immunities_lv3 = get_class_immunities("paladin", 3)
        assert "diseased" in immunities_lv3["condition_immunities"]

        # Check source
        disease_source = next(
            (s for s in immunities_lv3["sources"] if "diseased" in s["immunity"]),
            None
        )
        assert disease_source is not None
        assert disease_source["name"] == "圣洁体魄"
        assert disease_source["level"] == 3

    def test_monk_purity_of_body(self):
        """Monks at level 10+ are immune to disease and poison"""
        # Level 9 - no immunity yet
        immunities_lv9 = get_class_immunities("monk", 9)
        assert "diseased" not in immunities_lv9["condition_immunities"]
        assert "poisoned" not in immunities_lv9["condition_immunities"]

        # Level 10 - gains Purity of Body
        immunities_lv10 = get_class_immunities("monk", 10)
        assert "diseased" in immunities_lv10["condition_immunities"]
        assert "poisoned" in immunities_lv10["condition_immunities"]
        assert "poison" in immunities_lv10["damage_immunities"]

    def test_chinese_class_names(self):
        """Chinese class names should also work"""
        immunities = get_class_immunities("圣武士", 3)
        assert "diseased" in immunities["condition_immunities"]


class TestCharacterImmunities:
    """Test aggregated character immunities"""

    def test_elf_paladin(self):
        """Elf Paladin combines race and class immunities"""
        character_data = {
            "race_id": "elf",
            "class_id": "paladin",
            "level": 3
        }
        immunities = get_character_immunities(character_data)

        # Should have both sleep (race) and disease (class) immunities
        assert "sleep" in immunities["condition_immunities"]
        assert "diseased" in immunities["condition_immunities"]
        assert "charmed" in immunities.get("saving_throw_advantage", [])

    def test_low_level_paladin(self):
        """Low level paladin doesn't have Divine Health yet"""
        character_data = {
            "race_id": "human",
            "class_id": "paladin",
            "level": 2
        }
        immunities = get_character_immunities(character_data)
        assert "diseased" not in immunities["condition_immunities"]

    def test_active_effects_immunities(self):
        """Active effects can grant temporary immunities"""
        character_data = {
            "race_id": "human",
            "class_id": "fighter",
            "level": 5
        }
        active_effects = [
            {
                "id": "protection_from_poison",
                "name": "防护毒素",
                "metadata": {
                    "immunities": {
                        "condition": ["poisoned"],
                        "damage": ["poison"]
                    }
                }
            }
        ]
        immunities = get_character_immunities(character_data, active_effects)
        assert "poisoned" in immunities["condition_immunities"]
        assert "poison" in immunities["damage_immunities"]


class TestMonsterImmunities:
    """Test monster immunities"""

    def test_monster_with_immunities(self):
        """Monster data should be parsed correctly"""
        monster_data = {
            "name": "Fire Elemental",
            "damage_immunities": ["fire", "poison"],
            "condition_immunities": ["exhaustion", "paralyzed", "petrified", "poisoned", "prone", "unconscious"]
        }
        immunities = get_monster_immunities(monster_data)

        assert "fire" in immunities["damage_immunities"]
        assert "poison" in immunities["damage_immunities"]
        assert "exhaustion" in immunities["condition_immunities"]
        assert "poisoned" in immunities["condition_immunities"]

    def test_monster_string_immunities(self):
        """Monster immunities as comma-separated string should work"""
        monster_data = {
            "name": "Zombie",
            "damage_immunities": "poison",
            "condition_immunities": "poisoned"
        }
        immunities = get_monster_immunities(monster_data)
        assert "poison" in immunities["damage_immunities"]
        assert "poisoned" in immunities["condition_immunities"]


class TestDamageImmunityCheck:
    """Test damage immunity checking"""

    def test_immune_damage(self):
        """Should detect immune damage types"""
        immunities = {
            "damage_immunities": ["fire", "poison"],
            "condition_immunities": [],
            "sources": [
                {"type": "monster", "name": "Fire Elemental", "immunity": "fire"},
                {"type": "monster", "name": "Fire Elemental", "immunity": "poison"}
            ]
        }

        is_immune, source = check_damage_immunity(immunities, "fire")
        assert is_immune is True
        assert source == "Fire Elemental"

    def test_not_immune_damage(self):
        """Should return False for non-immune damage types"""
        immunities = {
            "damage_immunities": ["fire"],
            "condition_immunities": [],
            "sources": []
        }

        is_immune, source = check_damage_immunity(immunities, "cold")
        assert is_immune is False
        assert source is None

    def test_chinese_damage_types(self):
        """Should handle Chinese damage type names"""
        immunities = {
            "damage_immunities": ["fire"],  # English
            "condition_immunities": [],
            "sources": []
        }

        # Should match Chinese "火焰" to English "fire"
        is_immune, _ = check_damage_immunity(immunities, "火焰")
        assert is_immune is True


class TestConditionImmunityCheck:
    """Test condition immunity checking"""

    def test_immune_condition(self):
        """Should detect immune conditions"""
        immunities = {
            "damage_immunities": [],
            "condition_immunities": ["sleep", "diseased"],
            "sources": [
                {"type": "race", "name": "精类血统", "immunity": "sleep"},
                {"type": "class", "name": "圣洁体魄", "immunity": "diseased"}
            ]
        }

        is_immune, source = check_condition_immunity(immunities, "sleep")
        assert is_immune is True
        assert source == "精类血统"

        is_immune, source = check_condition_immunity(immunities, "diseased")
        assert is_immune is True
        assert source == "圣洁体魄"

    def test_not_immune_condition(self):
        """Should return False for non-immune conditions"""
        immunities = {
            "damage_immunities": [],
            "condition_immunities": ["sleep"],
            "sources": []
        }

        is_immune, source = check_condition_immunity(immunities, "charmed")
        assert is_immune is False
        assert source is None


class TestSavingThrowAdvantage:
    """Test saving throw advantage checking"""

    def test_has_advantage(self):
        """Should detect saving throw advantage"""
        immunities = {
            "damage_immunities": [],
            "condition_immunities": [],
            "saving_throw_advantage": ["charmed"],
            "sources": [
                {"type": "race", "name": "精类血统", "immunity": "charmed"}
            ]
        }

        has_adv, source = get_saving_throw_advantage(immunities, "charmed")
        assert has_adv is True

    def test_no_advantage(self):
        """Should return False when no advantage"""
        immunities = {
            "damage_immunities": [],
            "condition_immunities": [],
            "saving_throw_advantage": [],
            "sources": []
        }

        has_adv, source = get_saving_throw_advantage(immunities, "charmed")
        assert has_adv is False
