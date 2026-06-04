"""Unit tests for creature-type matching used by spell effect exclusions.

Covers the cure-wounds / healing-word / mass-cure-wounds rule that undead and
constructs are not healed, plus the bilingual (CN/EN) matcher and the
monster_id -> type resolution fallback.
"""
from app.services.effect_engine.creature_types import (
    creature_type_matches,
    resolve_creature_type_from_monster_id,
)


class TestCreatureTypeMatches:
    def test_chinese_undead_matches_english_key(self):
        assert creature_type_matches("不死生物", ["undead", "construct"]) is True

    def test_chinese_construct_matches_english_key(self):
        assert creature_type_matches("构装体", ["undead", "construct"]) is True

    def test_english_undead_matches(self):
        assert creature_type_matches("Undead", ["undead", "construct"]) is True

    def test_mixed_string_with_embedded_chinese_undead(self):
        # Real dataset has entries like this messy mixed form.
        assert creature_type_matches(
            "成年蓝龙巫妖 Adult Blue Dracolich 不死生物", ["undead"]
        ) is True

    def test_humanoid_is_not_excluded_by_undead_construct(self):
        assert creature_type_matches("类人生物 (类地精)", ["undead", "construct"]) is False

    def test_empty_type_never_matches(self):
        assert creature_type_matches("", ["undead", "construct"]) is False
        assert creature_type_matches(None, ["undead", "construct"]) is False

    def test_empty_keys_never_match(self):
        assert creature_type_matches("不死生物", []) is False

    def test_construct_chinese_variant(self):
        assert creature_type_matches("构装生物", ["construct"]) is True


class TestResolveCreatureTypeFromMonsterId:
    def test_skeleton_resolves_to_undead_type(self):
        t = resolve_creature_type_from_monster_id("skeleton")
        assert creature_type_matches(t, ["undead"]) is True

    def test_animated_armor_resolves_to_construct_type(self):
        t = resolve_creature_type_from_monster_id("animated-armor")
        assert creature_type_matches(t, ["construct"]) is True

    def test_goblin_is_not_undead_or_construct(self):
        t = resolve_creature_type_from_monster_id("goblin")
        assert creature_type_matches(t, ["undead", "construct"]) is False

    def test_unknown_id_returns_empty(self):
        assert resolve_creature_type_from_monster_id("not-a-real-monster") == ""
        assert resolve_creature_type_from_monster_id(None) == ""
