#!/usr/bin/env python3
"""
Fix 27 spells in spells.json whose effects were incorrect or incomplete.
Fixes include: removing wrong conditions, adding narratives, correcting
damage formulas, and restructuring effect phases.
"""
import json
import os

SPELLS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "app", "data", "rules", "spells.json"
)

# Each entry: spell_id -> new effects array (and optional concentration fix)
FIXES = {
    # 7. unseen_servant - remove apply_condition: invisible
    "unseen_servant": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "在60尺内你指定的未被占据地面创造一个隐形、无心智、无形体的仆役："
                            "AC10、HP1、力量2，不能攻击。你可在自己回合用附赠动作下达精神命令，"
                            "使其移动至多15尺并与一个物件互动。"
                        ),
                    }
                ],
                "duration": {"rounds": 600},
            }
        ]
    },
    # 9. aid - add grant_temp_hp + narrative
    "aid": {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "grant_temp_hp", "formula": "5"},
                    {
                        "type": "narrative",
                        "description": "至多三名目标的生命值上限和当前生命值各增加5点。",
                    },
                ],
                "scaling": {"per_slot_above": 2, "extra_value": 5},
                "duration": {"rounds": 4800},
            }
        ]
    },
    # 13. protection_from_poison - remove apply_condition: poisoned
    "protection_from_poison": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "single"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "若目标处于中毒状态，则中和其所受毒素。在持续时间内，"
                            "目标对抗中毒所做豁免检定具有优势，并且对毒素伤害具有抗性。"
                        ),
                    },
                    {
                        "type": "grant_advantage",
                        "on": "save",
                        "consume_on_use": False,
                    },
                    {"type": "grant_resistance", "damage_types": ["poison"]},
                ],
                "duration": {"rounds": 36000},
            }
        ]
    },
    # 14. silence - remove apply_condition: deafened
    "silence": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {"type": "grant_resistance", "damage_types": ["thunder"]},
                    {
                        "type": "narrative",
                        "description": (
                            "以射程内一点为中心创造半径20尺球形无声区域。"
                            "区域内无法产生任何声音，区域内生物免疫雷鸣伤害。"
                            "在区域内施展需要语言成分的法术是不可能的。"
                        ),
                    },
                ],
                "duration": {"rounds": 100, "concentration": True},
            }
        ]
    },
    # 16. aura_of_vitality - add narrative
    "aura_of_vitality": {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "heal", "formula": "2d6"},
                    {
                        "type": "narrative",
                        "description": (
                            "30尺灵光随你移动。持续期间你可用附赠动作"
                            "使灵光内一个生物恢复2d6生命值。"
                        ),
                    },
                ],
                "duration": {"rounds": 10, "concentration": True},
            }
        ]
    },
    # 17. bestow_curse - remove deal_damage, add apply_condition + narrative
    "bestow_curse": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "wis", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "apply_condition",
                        "condition": "cursed",
                        "condition_cn": "诅咒",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "选择以下诅咒之一：指定一项属性，目标以该属性进行的"
                            "属性检定和豁免检定具有劣势；或目标对你的攻击检定具有劣势；"
                            "或目标在其每回合开始时必须进行感知豁免，失败则该回合浪费其动作；"
                            "或你对目标的攻击和法术额外造成1d8黯蚀伤害。"
                        ),
                    },
                ],
                "duration": {"rounds": 10, "concentration": True},
            }
        ]
    },
    # 18. clairvoyance - remove apply_condition invisible
    "clairvoyance": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "在射程内指定地点创造一个看不见的传感器。"
                            "施法时选择\u201c观察\u201d或\u201c聆听\u201d，你可通过传感器"
                            "使用所选感官感测该处，并可用一个动作在观察/聆听间切换。"
                        ),
                    }
                ],
                "duration": {"rounds": 100, "concentration": True},
            }
        ]
    },
    # 19. conjure_barrage - fix to 3d8 slashing
    "conjure_barrage": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "dex", "on_success": "half_damage"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "3d8",
                        "damage_type": "slashing",
                    }
                ],
            }
        ]
    },
    # 20. lightning_arrow - fix to 4d8 primary + 2d8 AoE
    "lightning_arrow": {
        "effects": [
            {
                "trigger": "on_cast",
                "attack": {"type": "ranged_spell", "on_miss": "half_damage"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "4d8",
                        "damage_type": "lightning",
                    }
                ],
                "scaling": {"per_slot_above": 3, "extra_dice": "1d8"},
                "duration": {"rounds": 1, "concentration": True},
            },
            {
                "trigger": "on_cast",
                "save": {"ability": "dex", "on_success": "half_damage"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "2d8",
                        "damage_type": "lightning",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "箭矢爆裂：命中与否，目标10尺内每个生物须进行DEX豁免，"
                            "失败受2d8闪电伤害，成功减半。"
                        ),
                    },
                ],
            },
        ]
    },
    # 21. vampiric_touch - add self-healing
    "vampiric_touch": {
        "effects": [
            {
                "trigger": "on_cast",
                "attack": {"type": "melee_spell", "on_miss": "no_effect"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "3d6",
                        "damage_type": "necrotic",
                    },
                    {"type": "heal", "formula": "half_damage"},
                    {
                        "type": "narrative",
                        "description": "命中后你恢复等同于所造成黯蚀伤害一半的生命值。",
                    },
                ],
                "scaling": {"per_slot_above": 3, "extra_dice": "1d6"},
                "duration": {"rounds": 10, "concentration": True},
            }
        ]
    },
    # 23. arcane_eye - remove apply_condition invisible
    "arcane_eye": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "创造一个不可见的漂浮秘法眼，具有30尺普通视觉与黑暗视觉。"
                            "你可用动作让其移动30尺。你通过精神连接共享其视觉。"
                        ),
                    }
                ],
                "duration": {"rounds": 600, "concentration": True},
            }
        ]
    },
    # 26. confusion - change incapacitated -> confused
    "confusion": {
        "fix_type": "patch_condition",
        "old_condition": "incapacitated",
        "new_condition": "confused",
    },
    # 27. control_water - remove deal_damage, replace with narrative
    "control_water": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "你选择以下效果之一操控范围内水体：涨潮（水位升高至多20尺）、"
                            "分水（开辟通道）、改流（水流改变方向）、漩涡（形成漩涡造成"
                            "2d8钝击伤害，STR豁免减半）。每轮可用动作切换效果。"
                        ),
                    }
                ],
                "duration": {"rounds": 100, "concentration": True},
            }
        ]
    },
    # 28. dimension_door - remove second phase with deal_damage
    "dimension_door": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "self"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "将你传送至射程(500尺)内指定地点；可带上一名自愿生物。"
                            "若目的地被占据则传送失败，你和同伴各受4d6力场伤害。"
                        ),
                    }
                ],
            }
        ]
    },
    # 30. mordenkainens_faithful_hound - narrative only, no attack
    "mordenkainens_faithful_hound": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "在30尺内指定点召唤一条幻影看门犬，持续8小时或被驱散。"
                            "犬可感知30尺内隐形生物。当敌对生物进入犬5尺内，犬以锐利吠声"
                            "（可被听到）和撕咬攻击（+攻击加值，命中造成4d8穿刺伤害）进行反应。"
                            "犬不可被移动或伤害。"
                        ),
                    }
                ],
                "duration": {"rounds": 4800},
            }
        ]
    },
    # 34. contact_other_plane - add incapacitated + narrative
    "contact_other_plane": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "int", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "6d6",
                        "damage_type": "psychic",
                    },
                    {
                        "type": "apply_condition",
                        "condition": "incapacitated",
                        "condition_cn": "失能",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "智力豁免DC15失败则受6d6心灵伤害并失能直到长休。"
                            "成功则可向该位面实体提出至多5个问题，每个问题获得简短回答。"
                        ),
                    },
                ],
            }
        ]
    },
    # 37. geas - add charmed + narrative
    "geas": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "wis", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "apply_condition",
                        "condition": "charmed",
                        "condition_cn": "魅惑",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "你命令目标执行或不执行某项行为。目标每次违反指令时受"
                            "5d10心灵伤害（每天至多一次）。指使术持续30天；"
                            "5环施放30天，7环1年，9环永久直到被解除。"
                        ),
                    },
                ],
                "duration": {"rounds": 432000},
            }
        ]
    },
    # 38. wall_of_force - remove apply_condition invisible
    "wall_of_force": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "创造不可见的力场墙（平面最多10块10x10面板，"
                            "或半径至多10尺半球/球体）。没有任何事物能物理穿过；"
                            "墙免疫所有伤害且不受解除魔法影响，但会被解离术摧毁。"
                        ),
                    }
                ],
                "duration": {"rounds": 100, "concentration": True},
            }
        ]
    },
    # 41. forbiddance - fix to narrative (conditional damage)
    "forbiddance": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "保护至多40000平方尺区域，防止位面旅行进出。"
                            "当天界、元素、精类、邪魔或不死生物（施法时选择1-2种）"
                            "首次进入或在区域内开始回合时，受5d10光耀或黯蚀伤害"
                            "（施法时选择）。本法术可为仪式施放；连续30天每天施放则永久持续。"
                        ),
                    }
                ],
                "duration": {"rounds": 14400},
            }
        ]
    },
    # 43. prismatic_spray - add narrative for multi-color effects
    "prismatic_spray": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "dex", "on_success": "half_damage"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "10d6",
                        "damage_type": "fire",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "每个目标随机决定光线颜色：红(10d6火焰DEX)、"
                            "橙(10d6酸DEX)、黄(10d6闪电DEX)、绿(10d6毒素CON)、"
                            "蓝(10d6冰冻DEX)、靛(DEX失败则震慑CON续豁)、"
                            "紫(DEX失败则目盲CON续豁失败传送异界)。投8=随机两道射线。"
                        ),
                    },
                ],
            }
        ]
    },
    # 44. sequester - remove apply_condition invisible
    "sequester": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "single"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "目标（自愿生物或物体）在法术结束前无法被侦测。"
                            "若目标为生物则进入假死状态且不会衰老。"
                            "你可设定提前终止条件。持续至被解除或满足终止条件。"
                        ),
                    }
                ],
            }
        ]
    },
    # 45. symbol - fix to narrative-based multi-glyph
    "symbol": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "con", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "在表面或门框铭刻徽记（施法时选择类型）：死亡(10d10黯蚀CON豁免半伤)、"
                            "争论(STR豁免失败争吵)、恐惧(WIS豁免失败恐惧30尺)、"
                            "绝望(CHA豁免失败绝望)、失能(CON失败失能)、"
                            "痛苦(CON失败失能+痛苦)、眩晕(INT豁免失败眩晕)、"
                            "昏迷(WIS豁免失败昏迷)。触发半径60尺，持续10轮。"
                        ),
                    }
                ],
            }
        ]
    },
    # 46. feeblemind - add condition + narrative
    "feeblemind": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "int", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "4d6",
                        "damage_type": "psychic",
                    },
                    {
                        "type": "apply_condition",
                        "condition": "feebleminded",
                        "condition_cn": "弱智",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "豁免失败：受4d6心灵伤害且智力和魅力变为1。"
                            "目标无法施法、使用魔法物品或理解语言。"
                            "每30天可重新进行智力豁免(DC同施法DC)，成功则法术结束。"
                        ),
                    },
                ],
            }
        ]
    },
    # 48. astral_projection - narrative only, no unconscious
    "astral_projection": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "multiple"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "你与至多8个自愿生物进行星界投影：本体留在原处并进入假死状态；"
                            "灵魂进入星界躯体。星界躯体保留本体数据。"
                            "星界躯体HP降至0或银线被切断则法术结束。"
                        ),
                    }
                ],
            }
        ]
    },
    # 49. power_word_heal - fix formula from HP_MAX to 700
    "power_word_heal": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "single"},
                "effects": [
                    {"type": "heal", "formula": "700"},
                    {
                        "type": "narrative",
                        "description": (
                            "目标恢复全部生命值，并解除魅惑、恐惧、麻痹、震慑状态。"
                            "若目标倒地则可立刻用反应站起。对不死生物或构装体无效。"
                        ),
                    },
                ],
            }
        ]
    },
    # 50. prismatic_wall - narrative multi-layer wall
    "prismatic_wall": {
        "effects": [
            {
                "trigger": "on_cast",
                "target": {"type": "zone"},
                "effects": [
                    {
                        "type": "narrative",
                        "description": (
                            "创造七层虹彩光墙。通过每层需对应豁免："
                            "红(DEX,50火焰失败/25成功)、橙(DEX,50酸)、"
                            "黄(DEX,50闪电)、绿(CON,50毒)、"
                            "蓝(STR+被束缚DEX续豁)、靛(CON失败石化WIS续豁)、"
                            "紫(DEX失败目盲WIS续豁失败传送异界)。可用特定法术逐层消除。"
                        ),
                    }
                ],
                "duration": {"rounds": 100},
            }
        ]
    },
    # 51. storm_of_vengeance - add deafened + narrative
    "storm_of_vengeance": {
        "effects": [
            {
                "trigger": "on_cast",
                "save": {"ability": "con", "on_success": "no_effect"},
                "effects": [
                    {
                        "type": "deal_damage",
                        "formula": "2d6",
                        "damage_type": "thunder",
                    },
                    {
                        "type": "apply_condition",
                        "condition": "deafened",
                        "condition_cn": "耳聋",
                    },
                    {
                        "type": "narrative",
                        "description": (
                            "第1轮：CON豁免失败2d6雷鸣+耳聋。第2轮：酸雨1d6酸蚀。"
                            "第3轮：6道闪电各DEX豁免10d6。第4轮：冰雹2d6钝击。"
                            "第5-10轮：暴风雪+冰雹(大雨+冰雹1d6冰冻+1d6钝击)。"
                            "360尺半径风暴随你移动。"
                        ),
                    },
                ],
                "duration": {"rounds": 10, "concentration": True},
            }
        ]
    },
}


def main():
    path = os.path.abspath(SPELLS_PATH)
    print(f"Loading spells from: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data["spells"]
    spell_map = {s["id"]: s for s in spells}

    fixed = 0
    skipped = []

    for spell_id, fix in FIXES.items():
        if spell_id not in spell_map:
            skipped.append(spell_id)
            print(f"  SKIP (not found): {spell_id}")
            continue

        spell = spell_map[spell_id]

        # Special case: confusion just patches condition name
        if fix.get("fix_type") == "patch_condition":
            old_cond = fix["old_condition"]
            new_cond = fix["new_condition"]
            changed = False
            for phase in spell.get("effects", []):
                for eff in phase.get("effects", []):
                    if eff.get("type") == "apply_condition" and eff.get("condition") == old_cond:
                        eff["condition"] = new_cond
                        changed = True
            if changed:
                fixed += 1
                print(f"  FIXED (patch_condition): {spell_id} - {old_cond} -> {new_cond}")
            else:
                print(f"  SKIP (condition not found): {spell_id}")
            continue

        # Standard fix: replace entire effects array
        if "effects" in fix:
            spell["effects"] = fix["effects"]
            fixed += 1
            print(f"  FIXED: {spell_id} (Lv{spell['level']})")

    # Write back
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\nDone: {fixed} spells fixed, {len(skipped)} not found.")
    if skipped:
        print(f"  Not found: {skipped}")


if __name__ == "__main__":
    main()
