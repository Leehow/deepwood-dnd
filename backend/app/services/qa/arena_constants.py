"""Static fixture data for the Spell Runtime QA Arena.

Coordinates are grid cells on a flat map (40px/cell, see dw-browser-test).
The caster sits center-left; monsters are arranged in a stable ring so the
browser driver can target by fixed grid position.
"""
QA_CAMPAIGN_NAME = "Spell Runtime QA Arena"
QA_MAP_URL = "qa_flat_grid"

# High spellcasting stats; effectively unlimited slots are set in arena_service
# by filling spell_slots_state with large values per level.
_HIGH = {"strength": 16, "dexterity": 16, "constitution": 16,
         "intelligence": 20, "wisdom": 20, "charisma": 16}
_AVG = {"strength": 12, "dexterity": 12, "constitution": 12,
        "intelligence": 10, "wisdom": 10, "charisma": 10}

# The six QA actors from the design spec. `knows_all_spells` actors are seeded
# with every spell id and effectively unlimited slots; `current_hp` defaults to
# max_hp unless overridden (low/downed allies start damaged).
QA_ACTORS = [
    {"key": "qa_all_spells_caster", "name": "QA 全法术施法者", "race_id": "human",
     "class_id": "wizard", "level": 20, "ability_scores": _HIGH, "grid": (6, 10),
     "max_hp": 200, "knows_all_spells": True},
    {"key": "qa_weapon_caster", "name": "QA 武器施法者", "race_id": "human",
     "class_id": "ranger", "level": 20, "ability_scores": _HIGH, "grid": (6, 9),
     "max_hp": 180, "knows_all_spells": True},
    {"key": "qa_healer", "name": "QA 治疗者", "race_id": "human",
     "class_id": "cleric", "level": 20, "ability_scores": _HIGH, "grid": (5, 10),
     "max_hp": 180, "knows_all_spells": True},
    {"key": "qa_low_hp_ally", "name": "QA 残血盟友", "race_id": "human",
     "class_id": "fighter", "level": 10, "ability_scores": _AVG, "grid": (5, 11),
     "max_hp": 80, "current_hp": 10, "knows_all_spells": False},
    {"key": "qa_downed_ally", "name": "QA 倒地盟友", "race_id": "human",
     "class_id": "fighter", "level": 10, "ability_scores": _AVG, "grid": (6, 11),
     "max_hp": 80, "current_hp": 0, "knows_all_spells": False},
    {"key": "qa_player_view_character", "name": "QA 玩家视角角色", "race_id": "human",
     "class_id": "rogue", "level": 10, "ability_scores": _AVG, "grid": (4, 10),
     "max_hp": 70, "knows_all_spells": False},
]

# Backward-compatible alias used by older references.
QA_CASTER = QA_ACTORS[0]

# Monsters: key, monster_id, name_cn, ac, hp, grid, plus optional resistance/
# immunity/condition flags consumed by the effect engine via status_effects.
QA_MONSTERS = [
    {"key": "normal_target_a", "monster_id": "goblin", "name_cn": "普通目标A", "ac": 13, "hp": 30, "grid": (10, 8)},
    {"key": "normal_target_b", "monster_id": "goblin", "name_cn": "普通目标B", "ac": 13, "hp": 30, "grid": (11, 8)},
    {"key": "low_ac_target", "monster_id": "goblin", "name_cn": "低AC目标", "ac": 5, "hp": 40, "grid": (10, 9)},
    {"key": "high_ac_target", "monster_id": "goblin", "name_cn": "高AC目标", "ac": 25, "hp": 40, "grid": (11, 9)},
    {"key": "low_save_target", "monster_id": "goblin", "name_cn": "低豁免目标", "ac": 12, "hp": 40,
     "grid": (10, 10), "ability_scores": {"strength": 1, "dexterity": 1, "constitution": 1,
                                          "intelligence": 1, "wisdom": 1, "charisma": 1}},
    {"key": "high_save_target", "monster_id": "goblin", "name_cn": "高豁免目标", "ac": 12, "hp": 40,
     "grid": (11, 10), "ability_scores": {"strength": 20, "dexterity": 20, "constitution": 20,
                                          "intelligence": 20, "wisdom": 20, "charisma": 20}},
    {"key": "fire_resistant_target", "monster_id": "goblin", "name_cn": "抗火目标", "ac": 12, "hp": 40,
     "grid": (10, 11), "resistances": ["fire"]},
    {"key": "poison_immune_target", "monster_id": "goblin", "name_cn": "毒免疫目标", "ac": 12, "hp": 40,
     "grid": (11, 11), "immunities": ["poison"]},
    {"key": "undead_target", "monster_id": "skeleton", "name_cn": "亡灵目标", "ac": 12, "hp": 40, "grid": (12, 8)},
    {"key": "construct_target", "monster_id": "animated-armor", "name_cn": "构装目标", "ac": 12, "hp": 40, "grid": (12, 9)},
    {"key": "condition_immune_target", "monster_id": "goblin", "name_cn": "状态免疫目标", "ac": 12, "hp": 40,
     "grid": (12, 10), "condition_immunities": ["charmed", "frightened", "paralyzed", "poisoned", "stunned"]},
    {"key": "mobile_target", "monster_id": "goblin", "name_cn": "移动目标", "ac": 12, "hp": 40, "grid": (14, 10)},
]

# Six-monster cluster for area/zone spells.
QA_CLUSTER = [
    {"key": f"cluster_targets_{i}", "monster_id": "goblin", "name_cn": f"集群目标{i}", "ac": 12, "hp": 25,
     "grid": (16 + (i - 1) % 3, 8 + (i - 1) // 3)}
    for i in range(1, 7)
]
