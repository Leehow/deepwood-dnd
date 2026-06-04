#!/usr/bin/env python3
"""
怪物数据增强脚本
- Part A: 正则解析现有怪物动作，添加结构化数值字段
- Part B: 转换 SRD 缺失怪物到我们的格式
- Part C: AI 翻译新增怪物的中文内容
"""

import json, re, math, time, sys, os
from pathlib import Path
from typing import Optional

# ─── 配置 ───
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MONSTERS_PATH = PROJECT_ROOT / "frontend/app/data/npc/monsters.json"
SRD_PATH = PROJECT_ROOT / "dnd-platform/references/5e-srd/5e-SRD-Monsters.json"

API_BASE = "https://yunwu.ai/v1"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.4"

# 伤害类型映射 (EN → CN)
DAMAGE_TYPE_MAP = {
    "bludgeoning": "钝击", "piercing": "穿刺", "slashing": "挥砍",
    "fire": "火焰", "cold": "寒冷", "lightning": "闪电",
    "thunder": "雷鸣", "acid": "强酸", "poison": "毒素",
    "necrotic": "黯蚀", "radiant": "光辉", "force": "力场",
    "psychic": "心灵",
}

# 中文伤害类型 → 英文
DAMAGE_TYPE_CN = {v: k for k, v in DAMAGE_TYPE_MAP.items()}

# 属性映射
ABILITY_MAP_EN = {
    "strength": "str", "dexterity": "dex", "constitution": "con",
    "intelligence": "int", "wisdom": "wis", "charisma": "cha",
}
ABILITY_MAP_CN = {
    "力量": "str", "敏捷": "dex", "体质": "con",
    "智力": "int", "感知": "wis", "魅力": "cha",
}

# 体型映射
SIZE_MAP = {
    "Tiny": "微型", "Small": "小型", "Medium": "中型",
    "Large": "大型", "Huge": "巨型", "Gargantuan": "超巨型",
}

# 类型映射
TYPE_MAP = {
    "aberration": "异怪", "beast": "野兽", "celestial": "天界生物",
    "construct": "构装体", "dragon": "龙类", "elemental": "元素生物",
    "fey": "精类", "fiend": "邪魔", "giant": "巨人",
    "humanoid": "人形生物", "monstrosity": "怪兽", "ooze": "泥怪",
    "plant": "植物", "undead": "不死生物", "swarm": "虫群",
    "swarm of tiny beasts": "微型野兽群",
}

# 阵营映射
ALIGNMENT_MAP = {
    "lawful good": "守序善良", "neutral good": "中立善良",
    "chaotic good": "混乱善良", "lawful neutral": "守序中立",
    "neutral": "绝对中立", "true neutral": "绝对中立",
    "chaotic neutral": "混乱中立", "lawful evil": "守序邪恶",
    "neutral evil": "中立邪恶", "chaotic evil": "混乱邪恶",
    "unaligned": "无阵营", "any alignment": "任意阵营",
    "any non-good alignment": "任意非善良阵营",
    "any non-lawful alignment": "任意非守序阵营",
    "any evil alignment": "任意邪恶阵营",
    "any chaotic alignment": "任意混乱阵营",
}


# ═══════════════════════════════════════════════
# Part A: 正则解析中文 description → 结构化字段
# ═══════════════════════════════════════════════

def calc_avg(dice_str: str) -> Optional[int]:
    """计算骰子表达式的期望值: '2d6+5' → 12"""
    m = re.match(r'(\d+)d(\d+)([+＋-]?\d*)', dice_str)
    if not m:
        return None
    count, sides = int(m.group(1)), int(m.group(2))
    mod = int(m.group(3).replace('＋', '+')) if m.group(3) else 0
    return math.floor(count * (sides + 1) / 2 + mod)


def parse_action_description(action: dict) -> dict:
    """从中文 description 中提取结构化数值字段"""
    desc = action.get("description", "")
    name = action.get("name", "")
    result = {}

    # actionType
    if "多重攻击" in name or "Multiattack" in name:
        result["actionType"] = "multiattack"
        return result  # multiattack 没有其他数值

    if "近战武器攻击" in desc or "近战法术攻击" in desc:
        result["actionType"] = "melee"
    elif "远程武器攻击" in desc or "远程法术攻击" in desc:
        result["actionType"] = "ranged"
    elif re.search(r'DC\s*\d+', desc) and not re.search(r'[+＋]\d+\s*命中', desc):
        result["actionType"] = "ability"

    # attackBonus — 多种格式: "+9命中" "命中+9" "命中加值 +4"
    m = re.search(r'(?:命中[加值]*\s*)?[+＋](\d+)\s*命中|命中\s*[+＋](\d+)', desc)
    if m:
        result["attackBonus"] = int(m.group(1) or m.group(2))

    # reach (近战触及)
    m = re.search(r'触及\s*(\d+)\s*尺', desc)
    if m:
        result["reach"] = int(m.group(1))

    # range (远程射程)
    m = re.search(r'射程\s*(\d+)\s*[/／]\s*(\d+)\s*尺', desc)
    if m:
        result["range"] = {"normal": int(m.group(1)), "long": int(m.group(2))}
    else:
        m = re.search(r'射程\s*(\d+)\s*尺', desc)
        if m and result.get("actionType") == "ranged":
            result["range"] = {"normal": int(m.group(1))}

    # damage — 多种格式:
    # "12（2d6+5）点钝击伤害" "1d6+2点挥砍伤害" "造成 5 (1d6+2) 点钝击伤害"
    damages = []
    # Pattern 1: avg(dice)type  —  "12（2d6+5）点钝击伤害"
    for m in re.finditer(
        r'(\d+)\s*[（(]\s*(\d+d\d+\s*[+＋-]?\s*\d*)\s*[)）]\s*点?\s*'
        r'(钝击|穿刺|挥砍|火焰|寒冷|闪电|雷鸣|强酸|毒素|黯蚀|光辉|力场|心灵)\s*伤害',
        desc
    ):
        dice = re.sub(r'\s+', '', m.group(2)).replace('＋', '+')
        damages.append({
            "dice": dice,
            "avg": int(m.group(1)),
            "type": DAMAGE_TYPE_CN.get(m.group(3), m.group(3)),
        })

    # Pattern 2: dice type (no avg) — "1d6+2点挥砍伤害"
    if not damages:
        for m in re.finditer(
            r'(\d+d\d+\s*[+＋-]?\s*\d*)\s*点?\s*'
            r'(钝击|穿刺|挥砍|火焰|寒冷|闪电|雷鸣|强酸|毒素|黯蚀|光辉|力场|心灵)\s*伤害',
            desc
        ):
            dice = re.sub(r'\s+', '', m.group(1)).replace('＋', '+')
            avg = calc_avg(dice)
            entry = {"dice": dice, "type": DAMAGE_TYPE_CN.get(m.group(2), m.group(2))}
            if avg:
                entry["avg"] = avg
            damages.append(entry)

    if damages:
        result["damage"] = damages

    # dc
    m = re.search(r'DC\s*(\d+)\s*(?:的?\s*)?(力量|敏捷|体质|智力|感知|魅力)', desc)
    if m:
        result["dc"] = {
            "value": int(m.group(1)),
            "ability": ABILITY_MAP_CN.get(m.group(2), m.group(2)),
        }

    return result


def enhance_existing_actions(monsters: list) -> int:
    """为所有现有怪物的 actions/legendaryActions 添加结构化字段"""
    enhanced = 0
    for monster in monsters:
        for action in monster.get("actions", []):
            fields = parse_action_description(action)
            if fields:
                action.update(fields)
                enhanced += 1

        # legendaryActions 是 dict{description, actions} 格式
        la = monster.get("legendaryActions")
        if isinstance(la, dict):
            for action in la.get("actions", []):
                fields = parse_action_description(action)
                if fields:
                    action.update(fields)
                    enhanced += 1
        elif isinstance(la, list):
            for action in la:
                fields = parse_action_description(action)
                if fields:
                    action.update(fields)
                    enhanced += 1

    return enhanced


# ═══════════════════════════════════════════════
# Part B: SRD 怪物转换
# ═══════════════════════════════════════════════

def parse_srd_speed(speed: dict) -> dict:
    """SRD speed → 我们的格式"""
    result = {}
    for key, val in speed.items():
        if isinstance(val, str):
            m = re.match(r'(\d+)', val)
            if m:
                result[key] = int(m.group(1))
        elif isinstance(val, (int, float)):
            result[key] = int(val)
    return result


def parse_srd_senses(senses: dict) -> dict:
    """SRD senses → 我们的格式"""
    result = {}
    for key, val in senses.items():
        if key == "passive_perception":
            result["passivePerception"] = val
        elif isinstance(val, str):
            m = re.match(r'(\d+)', val)
            if m:
                result[key] = int(m.group(1))
    return result


def parse_srd_proficiencies(profs: list) -> dict:
    """SRD proficiencies → 我们的格式"""
    result = {}
    for p in profs:
        name = p["proficiency"]["name"]
        val = p["value"]
        if "Saving Throw" in name:
            ability = name.split(": ")[-1].lower()
            result.setdefault("savingThrows", {})[ability] = val
        elif "Skill" in name:
            skill = name.split(": ")[-1].lower()
            result.setdefault("skills", {})[skill] = val
    return result


def convert_srd_action(action: dict) -> dict:
    """SRD action → 我们的格式 (英文，待翻译)"""
    result = {
        "name": action["name"],
        "description": action.get("desc", ""),
    }

    # actionType
    if action.get("multiattack_type"):
        result["actionType"] = "multiattack"
        return result

    desc = action.get("desc", "")
    if "Melee Weapon Attack" in desc or "Melee Spell Attack" in desc:
        result["actionType"] = "melee"
    elif "Ranged Weapon Attack" in desc or "Ranged Spell Attack" in desc:
        result["actionType"] = "ranged"

    # attackBonus
    if "attack_bonus" in action:
        result["attackBonus"] = action["attack_bonus"]

    # reach
    m = re.search(r'reach (\d+) ft', desc)
    if m:
        result["reach"] = int(m.group(1))

    # range
    m = re.search(r'range (\d+)/(\d+) ft', desc)
    if m:
        result["range"] = {"normal": int(m.group(1)), "long": int(m.group(2))}
    else:
        m = re.search(r'range (\d+) ft', desc)
        if m and result.get("actionType") == "ranged":
            result["range"] = {"normal": int(m.group(1))}

    # damage from SRD structured data
    if "damage" in action:
        damages = []
        for d in action["damage"]:
            entry = {}
            if "damage_dice" in d:
                entry["dice"] = d["damage_dice"]
                avg = calc_avg(d["damage_dice"])
                if avg:
                    entry["avg"] = avg
            if "damage_type" in d:
                dtype = d["damage_type"]["index"]
                entry["type"] = dtype
            if entry:
                damages.append(entry)
        if damages:
            result["damage"] = damages

    # dc from SRD
    if "dc" in action:
        dc = action["dc"]
        result["dc"] = {
            "value": dc.get("dc_value", 0),
            "ability": ABILITY_MAP_EN.get(
                dc.get("dc_type", {}).get("index", ""), ""
            ),
        }

    return result


def convert_srd_monster(srd_m: dict) -> dict:
    """SRD 怪物 → 我们的格式 (英文字段，中文待翻译)"""
    # AC
    ac_data = srd_m.get("armor_class", [{}])[0]
    ac = ac_data.get("value", 10)
    ac_type = ac_data.get("type", "")

    # ability scores
    str_val = srd_m.get("strength", 10)
    dex_val = srd_m.get("dexterity", 10)
    con_val = srd_m.get("constitution", 10)
    int_val = srd_m.get("intelligence", 10)
    wis_val = srd_m.get("wisdom", 10)
    cha_val = srd_m.get("charisma", 10)

    def mod(v): return (v - 10) // 2

    # Proficiencies
    profs = parse_srd_proficiencies(srd_m.get("proficiencies", []))

    # Actions
    actions = [convert_srd_action(a) for a in srd_m.get("actions", [])]

    # Legendary actions
    srd_la = srd_m.get("legendary_actions", [])
    legendary_actions = None
    if srd_la:
        legendary_actions = {
            "description": f"The {srd_m['name']} can take 3 legendary actions.",
            "actions": [convert_srd_action(a) for a in srd_la],
        }

    # Special abilities
    special = []
    for sa in srd_m.get("special_abilities", []):
        special.append({"name": sa["name"], "description": sa.get("desc", "")})

    # Damage types
    def map_damages(lst):
        return [DAMAGE_TYPE_MAP.get(d, d) for d in lst]

    # Condition immunities
    ci = [c.get("name", c) if isinstance(c, dict) else c
          for c in srd_m.get("condition_immunities", [])]

    monster = {
        "id": srd_m["index"],
        "name": srd_m["name"],  # 待翻译
        "nameEn": srd_m["name"],
        "speed": parse_srd_speed(srd_m.get("speed", {})),
        "abilityScores": {
            "str": str_val, "strMod": mod(str_val),
            "dex": dex_val, "dexMod": mod(dex_val),
            "con": con_val, "conMod": mod(con_val),
            "int": int_val, "intMod": mod(int_val),
            "wis": wis_val, "wisMod": mod(wis_val),
            "cha": cha_val, "chaMod": mod(cha_val),
        },
        "languages": (srd_m.get("languages", "") or "").split(", ")
                     if srd_m.get("languages") else [],
        "senses": parse_srd_senses(srd_m.get("senses", {})),
        "size": SIZE_MAP.get(srd_m.get("size", "Medium"), "中型"),
        "type": TYPE_MAP.get(srd_m.get("type", "").lower(), srd_m.get("type", "")),
        "alignment": ALIGNMENT_MAP.get(
            srd_m.get("alignment", "").lower(), srd_m.get("alignment", "")
        ),
        "ac": ac,
        "hp": srd_m.get("hit_points", 0),
        "hpFormula": srd_m.get("hit_points_roll", srd_m.get("hit_dice", "")),
        "cr": srd_m.get("challenge_rating", 0),
        "xp": srd_m.get("xp", 0),
        "description": "",  # 待 AI 翻译
        "specialAbilities": special,
        "actions": actions,
        "appearance": "",  # 待 AI 翻译
        "damageVulnerabilities": map_damages(
            srd_m.get("damage_vulnerabilities", [])
        ),
        "damageResistances": map_damages(
            srd_m.get("damage_resistances", [])
        ),
        "damageImmunities": map_damages(
            srd_m.get("damage_immunities", [])
        ),
        "conditionImmunities": ci,
    }

    if profs:
        monster["proficiencies"] = profs
    if ac_type:
        monster["acType"] = ac_type
    if legendary_actions:
        monster["legendaryActions"] = legendary_actions

    return monster


# ═══════════════════════════════════════════════
# Part C: AI 翻译
# ═══════════════════════════════════════════════

def call_ai(prompt: str, system: str = "", retries: int = 3) -> str:
    """调用 AI API"""
    import urllib.request
    import urllib.error

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = json.dumps({
        "model": MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 8000,
    }).encode()

    req = urllib.request.Request(
        f"{API_BASE}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )

    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"  API call attempt {attempt+1} failed: {e}")
            if attempt < retries - 1:
                time.sleep(3)
    return ""


def extract_json_from_response(text: str) -> str:
    """从 AI 响应中提取 JSON"""
    # Try code block first
    m = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', text)
    if m:
        return m.group(1).strip()
    # Try raw JSON array/object
    m = re.search(r'(\[[\s\S]*\]|\{[\s\S]*\})', text)
    if m:
        return m.group(1).strip()
    return text.strip()


def translate_monsters_batch(monsters: list) -> list:
    """批量翻译怪物的中文内容"""
    system = """你是D&D 5E怪物数据翻译专家。请将怪物数据翻译为中文。
规则：
1. name 字段格式为"中文名"，nameEn 保持英文不变
2. description 写2-3句中文背景描述
3. appearance 写2-3句中文外貌描述
4. specialAbilities 的 name 格式为"中文名 (English Name)"，description 翻译为中文
5. actions 的 name 格式为"中文名 English Name"，description 翻译为中文（保留数值不变）
6. legendaryActions 同 actions 格式
7. 保持所有数值字段（attackBonus, damage, dc 等）不变
8. 返回纯 JSON 数组"""

    # Prepare simplified data for translation
    to_translate = []
    for m in monsters:
        entry = {
            "nameEn": m["nameEn"],
            "type": m["type"],
            "cr": m["cr"],
            "specialAbilities": [
                {"name": sa["name"], "description": sa["description"][:300]}
                for sa in m.get("specialAbilities", [])
            ],
            "actions": [
                {"name": a["name"], "description": a["description"][:300]}
                for a in m.get("actions", [])
            ],
        }
        la = m.get("legendaryActions")
        if la and isinstance(la, dict):
            entry["legendaryActions"] = [
                {"name": a["name"], "description": a["description"][:300]}
                for a in la.get("actions", [])
            ]
        to_translate.append(entry)

    prompt = f"""请翻译以下 {len(monsters)} 个D&D 5E怪物。
对每个怪物返回：
- "nameEn": 原英文名（不变）
- "name": 中文名
- "description": 中文背景描述（2-3句）
- "appearance": 中文外貌描述（2-3句）
- "specialAbilities": [{{"name": "中文名 (English)", "description": "中文描述"}}]
- "actions": [{{"name": "中文名 English", "description": "中文描述（保留所有数值）"}}]
- "legendaryActions": 同 actions（如果有的话）

怪物数据：
{json.dumps(to_translate, indent=2, ensure_ascii=False)}

返回 JSON 数组，每个元素对应一个怪物。"""

    response = call_ai(prompt, system)
    if not response:
        return monsters

    try:
        raw = extract_json_from_response(response)
        translated = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  JSON parse error: {e}")
        return monsters

    # Merge translations back
    name_map = {t["nameEn"]: t for t in translated}
    for m in monsters:
        t = name_map.get(m["nameEn"])
        if not t:
            continue
        m["name"] = t.get("name", m["name"])
        m["description"] = t.get("description", "")
        m["appearance"] = t.get("appearance", "")

        # Merge specialAbilities
        if t.get("specialAbilities"):
            t_sa_map = {sa.get("name", "").split("(")[0].strip()
                        if "(" in sa.get("name", "") else sa.get("name", ""): sa
                        for sa in t["specialAbilities"]}
            for i, sa in enumerate(m.get("specialAbilities", [])):
                # Try matching by index first (most reliable)
                if i < len(t.get("specialAbilities", [])):
                    tsa = t["specialAbilities"][i]
                    sa["name"] = tsa.get("name", sa["name"])
                    sa["description"] = tsa.get("description", sa["description"])

        # Merge actions
        if t.get("actions"):
            for i, action in enumerate(m.get("actions", [])):
                if i < len(t.get("actions", [])):
                    ta = t["actions"][i]
                    action["name"] = ta.get("name", action["name"])
                    action["description"] = ta.get("description", action["description"])

        # Merge legendaryActions
        if t.get("legendaryActions"):
            la = m.get("legendaryActions")
            if isinstance(la, dict) and "actions" in la:
                for i, action in enumerate(la["actions"]):
                    if i < len(t["legendaryActions"]):
                        ta = t["legendaryActions"][i]
                        action["name"] = ta.get("name", action["name"])
                        action["description"] = ta.get("description",
                                                        action["description"])

    return monsters


# ═══════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════

def main():
    print("=== 怪物数据增强脚本 ===\n")

    # Load data
    with open(MONSTERS_PATH) as f:
        data = json.load(f)
    monsters = data["monsters"]
    print(f"现有怪物: {len(monsters)}")

    with open(SRD_PATH) as f:
        srd_data = json.load(f)
    print(f"SRD 怪物: {len(srd_data)}")

    # ── Part A: 解析现有怪物动作 ──
    print("\n── Part A: 解析现有怪物动作 ──")
    enhanced_count = enhance_existing_actions(monsters)
    print(f"增强了 {enhanced_count} 个动作")

    # ── Part B: 找出缺失怪物并转换 ──
    print("\n── Part B: 转换 SRD 缺失怪物 ──")
    our_names = set()
    for m in monsters:
        if m.get("nameEn"):
            our_names.add(m["nameEn"].lower().strip())

    # 跳过变体形态（我们已有基础怪物）
    skip_patterns = [
        ", Bat Form", ", Mist Form", ", Vampire Form",
        ", Bear Form", ", Human Form", ", Hybrid Form",
        ", Boar Form", ", Rat Form", ", Tiger Form",
        ", Wolf Form",
        "Giant Rat (Diseased)",  # 我们有 Giant Rat
    ]

    missing = []
    for srd_m in srd_data:
        srd_name = srd_m["name"]
        if srd_name.lower().strip() in our_names:
            continue
        if any(p in srd_name for p in skip_patterns):
            continue
        missing.append(srd_m)

    print(f"缺失怪物 (排除变体): {len(missing)}")
    for m in missing:
        print(f"  - {m['name']} (CR {m['challenge_rating']})")

    # Convert SRD → our format
    new_monsters = [convert_srd_monster(srd_m) for srd_m in missing]

    # Re-parse actions for new monsters (extract structured fields from desc)
    for m in new_monsters:
        for action in m.get("actions", []):
            # Parse from English description too
            desc = action.get("description", "")
            if action.get("actionType") == "multiattack":
                continue
            # Extract reach/range from English desc if not already set
            if "reach" not in action:
                rm = re.search(r'reach (\d+) ft', desc)
                if rm:
                    action["reach"] = int(rm.group(1))
            if "range" not in action:
                rm = re.search(r'range (\d+)/(\d+) ft', desc)
                if rm:
                    action["range"] = {
                        "normal": int(rm.group(1)),
                        "long": int(rm.group(2)),
                    }

    # ── Part C: AI 翻译 ──
    print(f"\n── Part C: AI 翻译 {len(new_monsters)} 个新怪物 ──")

    if "--skip-translate" in sys.argv:
        print("跳过翻译 (--skip-translate)")
    else:
        batch_size = 6
        for i in range(0, len(new_monsters), batch_size):
            batch = new_monsters[i:i+batch_size]
            names = [m["nameEn"] for m in batch]
            print(f"\n翻译批次 {i//batch_size+1}: {', '.join(names)}")
            translate_monsters_batch(batch)
            # Re-parse translated Chinese descriptions
            for m in batch:
                for action in m.get("actions", []):
                    cn_fields = parse_action_description(action)
                    if cn_fields:
                        # Merge without overwriting existing structured fields
                        for k, v in cn_fields.items():
                            if k not in action:
                                action[k] = v
            time.sleep(1)

    # ── 合并并输出 ──
    print(f"\n── 合并结果 ──")
    monsters.extend(new_monsters)
    # Sort by CR then name
    def sort_key(m):
        cr = m.get("cr", 0)
        if isinstance(cr, str):
            try: cr = float(cr)
            except: cr = 0
        return (cr, m.get("nameEn", ""))
    monsters.sort(key=sort_key)

    data["monsters"] = monsters
    data["overview"]["totalMonsters"] = len(monsters)
    data["overview"]["completeness"] = f"{len(monsters)}/492"
    data["overview"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    data["overview"]["lastOptimized"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    data["overview"]["optimizationNote"] = (
        "Enhanced with structured action fields (attackBonus, damage, dc, reach, range, actionType). "
        f"Added {len(new_monsters)} missing SRD monsters with AI translations."
    )

    with open(MONSTERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✓ 完成! 总怪物数: {len(monsters)}")
    print(f"  新增: {len(new_monsters)}")
    print(f"  动作增强: {enhanced_count}")

    # Stats
    total_with_type = sum(
        1 for m in monsters
        for a in m.get("actions", [])
        if "actionType" in a
    )
    total_with_damage = sum(
        1 for m in monsters
        for a in m.get("actions", [])
        if "damage" in a
    )
    total_actions_all = sum(len(m.get("actions", [])) for m in monsters)
    print(f"\n统计:")
    print(f"  总动作数: {total_actions_all}")
    print(f"  有 actionType: {total_with_type}")
    print(f"  有 damage: {total_with_damage}")


if __name__ == "__main__":
    main()
