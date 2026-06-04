#!/usr/bin/env python3
"""
怪物数据优化脚本
从 SRD 参考数据补充结构化字段，用 LLM 处理无法匹配的怪物。

优化项：
1. 补充 proficiencies（豁免/技能熟练）
2. 补充 acType（AC来源类型）
3. damageResistances/Immunities/Vulnerabilities/conditionImmunities → 数组
4. CR: string → number
5. 补充缺失的 senses/languages
6. 去除能力值重复字段（str/dex/con等顶层字段）
"""

import json
import os
import time
import re
import copy
import httpx
from pathlib import Path
from typing import Optional

# ── 配置 ──
API_BASE = "https://yunwu.ai/v1"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.4"

PROJECT_ROOT = Path(__file__).parent.parent
MONSTERS_PATH = PROJECT_ROOT / "dnd-platform/configs/npc/monsters.json"
SRD_PATH = PROJECT_ROOT / "dnd-platform/references/5e-srd/5e-SRD-Monsters.json"
OUTPUT_PATH = PROJECT_ROOT / "dnd-platform/configs/npc/monsters_optimized.json"
LOG_PATH = PROJECT_ROOT / "scripts/monster_optimize_log.json"

# ── 中英文映射 ──
SIZE_MAP = {
    "Tiny": "微型", "Small": "小型", "Medium": "中型",
    "Large": "大型", "Huge": "巨型", "Gargantuan": "超巨型"
}
SIZE_MAP_REV = {v: k for k, v in SIZE_MAP.items()}

# SRD damage type index → 中文
DAMAGE_TYPE_CN = {
    "acid": "强酸", "bludgeoning": "钝击", "cold": "冷冻",
    "fire": "火焰", "force": "力场", "lightning": "闪电",
    "necrotic": "黯蚀", "piercing": "穿刺", "poison": "毒素",
    "psychic": "心灵", "radiant": "光耀", "slashing": "挥砍",
    "thunder": "雷鸣"
}

CONDITION_CN = {
    "blinded": "目盲", "charmed": "魅惑", "deafened": "耳聋",
    "frightened": "恐慌", "grappled": "擒抱", "incapacitated": "失能",
    "invisible": "隐形", "paralyzed": "麻痹", "petrified": "石化",
    "poisoned": "中毒", "prone": "俯卧", "restrained": "束缚",
    "stunned": "震慑", "unconscious": "昏迷", "exhaustion": "力竭"
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved to {path}")


def build_srd_index(srd_monsters):
    """构建 SRD 怪物索引（按 name 小写匹配）"""
    idx = {}
    for m in srd_monsters:
        idx[m["name"].lower()] = m
        # 也用 index 字段建索引
        idx[m["index"]] = m
    return idx


def normalize_name(name: str) -> str:
    """标准化名称用于匹配"""
    return name.lower().strip().replace("'", "'").replace("'", "'")


# ── SRD 数据提取 ──

def extract_proficiencies(srd_monster):
    """从 SRD 提取熟练项（豁免和技能）"""
    profs = srd_monster.get("proficiencies", [])
    saving_throws = {}
    skills = {}
    for p in profs:
        prof_info = p.get("proficiency", {})
        idx = prof_info.get("index", "")
        value = p.get("value", 0)
        if idx.startswith("saving-throw-"):
            ability = idx.replace("saving-throw-", "").upper()
            saving_throws[ability] = value
        elif idx.startswith("skill-"):
            skill_name = prof_info.get("name", "").replace("Skill: ", "")
            skills[skill_name] = value
    return {"savingThrows": saving_throws, "skills": skills}


def extract_ac_info(srd_monster):
    """从 SRD 提取 AC 类型信息"""
    ac_list = srd_monster.get("armor_class", [])
    if not ac_list:
        return None
    ac = ac_list[0]
    result = {"value": ac.get("value"), "type": ac.get("type", "natural")}
    # 有些有 armor 字段
    if "armor" in ac:
        result["armor"] = [a.get("name", "") for a in ac["armor"]]
    return result


def extract_senses(srd_monster):
    """从 SRD 提取感官数据"""
    senses = srd_monster.get("senses", {})
    result = {}
    for key, val in senses.items():
        if key == "passive_perception":
            result["passivePerception"] = val
        else:
            # "120 ft." → 120
            match = re.search(r"(\d+)", str(val))
            result[key] = int(match.group(1)) if match else val
    return result


def extract_damage_array(srd_list, cn_map=DAMAGE_TYPE_CN):
    """SRD damage type 列表 → 中英双语数组"""
    if not srd_list:
        return []
    result = []
    for item in srd_list:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            idx = item.get("index", "")
            result.append(idx)
    return result


def extract_condition_array(srd_list):
    """SRD condition 列表 → 数组"""
    if not srd_list:
        return []
    result = []
    for item in srd_list:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            result.append(item.get("index", ""))
    return result


def parse_cr(cr_val):
    """CR 转数字"""
    if isinstance(cr_val, (int, float)):
        return cr_val
    if isinstance(cr_val, str):
        cr_val = cr_val.strip()
        if "/" in cr_val:
            parts = cr_val.split("/")
            try:
                return int(parts[0]) / int(parts[1])
            except (ValueError, ZeroDivisionError):
                return 0
        try:
            return int(cr_val)
        except ValueError:
            try:
                return float(cr_val)
            except ValueError:
                return 0
    return 0


# ── LLM 批处理 ──

def call_llm(prompt: str, system: str = "", max_retries=3) -> Optional[str]:
    """调用 LLM API"""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    f"{API_BASE}/chat/completions",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                    json={
                        "model": MODEL,
                        "messages": messages,
                        "temperature": 0.1,
                        "max_tokens": 2000,
                    },
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"  ⚠️ LLM call failed (attempt {attempt+1}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return None


def parse_chinese_damage_string(cn_str: str) -> list[str]:
    """
    解析中文伤害类型字符串为英文ID数组
    例: "光耀,非魔法攻击的钝击、穿刺、挥砍" → ["radiant", "bludgeoning", "piercing", "slashing"]
    """
    if not cn_str or not isinstance(cn_str, str):
        return []

    # 如果内容包含大量非伤害类型文本（如 Flying Sword 的混乱数据），用 LLM 解析
    if len(cn_str) > 100:
        return None  # 标记为需要 LLM 处理

    cn_to_en = {v: k for k, v in DAMAGE_TYPE_CN.items()}
    result = []

    # 按逗号和顿号分割
    parts = re.split(r"[,，]", cn_str)
    has_nonmagical = False

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # 检查"非魔法攻击的X、Y、Z"模式
        nonmagic_match = re.match(r"非魔法攻击的(.+)", part)
        if nonmagic_match:
            has_nonmagical = True
            sub_types = re.split(r"[、]", nonmagic_match.group(1))
            for st in sub_types:
                st = st.strip()
                if st in cn_to_en:
                    result.append(cn_to_en[st])
            continue

        # 含顿号的多类型
        sub_parts = re.split(r"[、]", part)
        for sp in sub_parts:
            sp = sp.strip()
            if sp in cn_to_en:
                result.append(cn_to_en[sp])

    if has_nonmagical and result:
        # 标记非魔法抗性
        return {"types": result, "nonmagical": True}

    return result if result else None  # None = 需要 LLM


def parse_chinese_condition_string(cn_str: str) -> list[str]:
    """解析中文状态免疫字符串"""
    if not cn_str or not isinstance(cn_str, str):
        return []

    cn_to_en = {v: k for k, v in CONDITION_CN.items()}
    result = []
    parts = re.split(r"[,，、]", cn_str)
    for part in parts:
        part = part.strip()
        if part in cn_to_en:
            result.append(cn_to_en[part])
    return result if result else None


def batch_llm_parse_damage(monsters_needing_llm):
    """批量用 LLM 解析无法程序化解析的伤害/状态字符串"""
    if not monsters_needing_llm:
        return {}

    system = """你是 D&D 5E 数据结构化专家。将中文怪物属性文本解析为结构化 JSON。
只输出 JSON，不要其他文字。"""

    results = {}
    batch_size = 5

    for i in range(0, len(monsters_needing_llm), batch_size):
        batch = monsters_needing_llm[i:i + batch_size]
        prompt_parts = []
        for idx, (monster_id, fields) in enumerate(batch):
            prompt_parts.append(f"怪物 {idx + 1} (id: {monster_id}):")
            for field_name, raw_value in fields.items():
                prompt_parts.append(f"  {field_name}: \"{raw_value}\"")

        prompt = f"""请将以下怪物的属性文本解析为结构化数据。

{chr(10).join(prompt_parts)}

输出格式（JSON 数组）:
[
  {{
    "id": "monster_id",
    "damageResistances": ["acid", "fire"],  // 英文伤害类型ID
    "damageImmunities": ["poison"],
    "damageVulnerabilities": [],
    "conditionImmunities": ["poisoned", "charmed"],  // 英文状态ID
    "nonmagicalResistance": false,  // 是否有"非魔法攻击"抗性
    "nonmagicalResistanceTypes": []  // 非魔法抗性的伤害类型
  }}
]

可用伤害类型: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder
可用状态: blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious

注意：
- 如果原文包含混乱的非伤害类型文本，只提取其中的伤害/状态信息
- "非魔法攻击的钝击、穿刺、挥砍" 表示 nonmagicalResistance=true, nonmagicalResistanceTypes=["bludgeoning","piercing","slashing"]
- 如果无法识别，返回空数组"""

        response = call_llm(prompt, system)
        if response:
            try:
                # 提取 JSON
                json_match = re.search(r"\[[\s\S]*\]", response)
                if json_match:
                    parsed = json.loads(json_match.group())
                    for item in parsed:
                        results[item["id"]] = item
            except (json.JSONDecodeError, KeyError) as e:
                print(f"  ⚠️ JSON parse error for batch {i}: {e}")

        if i + batch_size < len(monsters_needing_llm):
            time.sleep(1)  # 限流

    return results


def batch_llm_generate_proficiencies(monsters_without_srd):
    """批量用 LLM 为非 SRD 怪物生成 proficiencies"""
    if not monsters_without_srd:
        return {}

    system = """你是 D&D 5E 怪物数据专家。根据怪物的基本属性，推算其应有的豁免和技能熟练。
按照 5E 规则：熟练加值 = 2 + (CR-1)/4 向下取整（最低2）。
豁免加值 = 属性修正 + 熟练加值。技能加值 = 相关属性修正 + 熟练加值。
只输出 JSON，不要其他文字。"""

    results = {}
    batch_size = 5

    for i in range(0, len(monsters_without_srd), batch_size):
        batch = monsters_without_srd[i:i + batch_size]
        prompt_parts = []
        for idx, m in enumerate(batch):
            ab = m.get("abilityScores", {})
            prompt_parts.append(
                f"怪物 {idx+1} (id: {m['id']}, nameEn: {m.get('nameEn','?')}):\n"
                f"  CR: {m.get('cr', '?')}, AC: {m.get('ac','?')}, HP: {m.get('hp','?')}\n"
                f"  STR:{ab.get('str','?')} DEX:{ab.get('dex','?')} CON:{ab.get('con','?')} "
                f"INT:{ab.get('int','?')} WIS:{ab.get('wis','?')} CHA:{ab.get('cha','?')}\n"
                f"  类型: {m.get('type','?')}, 特殊能力: {[a.get('name','') for a in m.get('specialAbilities', [])]}"
            )

        prompt = f"""根据以下怪物属性，推算其豁免和技能熟练（只列出有熟练的项）。

{chr(10).join(prompt_parts)}

输出格式（JSON 数组）:
[
  {{
    "id": "monster_id",
    "savingThrows": {{"CON": 6, "WIS": 5}},
    "skills": {{"Perception": 8, "Stealth": 6}}
  }}
]

规则：
- 只列出怪物确实应该有熟练的豁免和技能
- 低 CR 怪物（0-1）通常只有 0-2 个熟练项
- 高 CR 怪物通常有更多熟练项
- 兽类通常有 Perception 和 Stealth
- 不死生物通常免疫 WIS 豁免
- 参考怪物的特殊能力来推断技能"""

        response = call_llm(prompt, system)
        if response:
            try:
                json_match = re.search(r"\[[\s\S]*\]", response)
                if json_match:
                    parsed = json.loads(json_match.group())
                    for item in parsed:
                        results[item["id"]] = item
            except (json.JSONDecodeError, KeyError) as e:
                print(f"  ⚠️ JSON parse error for proficiency batch {i}: {e}")

        if i + batch_size < len(monsters_without_srd):
            time.sleep(1)

    return results


# ── 主流程 ──

def optimize_monsters():
    print("🔧 怪物数据优化脚本启动")
    print("=" * 60)

    # 加载数据
    our_data = load_json(MONSTERS_PATH)
    srd_data = load_json(SRD_PATH)
    monsters = our_data["monsters"]
    srd_index = build_srd_index(srd_data)

    print(f"📦 我方怪物: {len(monsters)}")
    print(f"📦 SRD 怪物: {len(srd_data)}")

    # 统计
    stats = {
        "total": len(monsters),
        "srd_matched": 0,
        "llm_processed": 0,
        "proficiencies_added": 0,
        "ac_type_added": 0,
        "damage_arrays_fixed": 0,
        "cr_fixed": 0,
        "senses_enriched": 0,
        "duplicates_removed": 0,
        "errors": [],
    }

    # Phase 1: SRD 匹配 + 程序化修复
    print("\n📌 Phase 1: SRD 匹配 + 程序化修复")
    monsters_needing_llm_damage = []  # (id, {field: raw_value})
    monsters_needing_llm_prof = []    # 无 SRD 匹配的怪物

    for m in monsters:
        name_en = normalize_name(m.get("nameEn", ""))
        srd_match = srd_index.get(name_en) or srd_index.get(name_en.replace(" ", "-"))

        # ── 1. CR → number ──
        old_cr = m.get("cr")
        m["cr"] = parse_cr(old_cr)
        if str(old_cr) != str(m["cr"]):
            stats["cr_fixed"] += 1

        # ── 2. 去除顶层重复能力值 ──
        dup_fields = ["str", "dex", "con", "int", "wis", "cha",
                       "strMod", "dexMod", "conMod", "intMod", "wisMod", "chaMod"]
        removed_any = False
        for f in dup_fields:
            if f in m and "abilityScores" in m:
                del m[f]
                removed_any = True
        if removed_any:
            stats["duplicates_removed"] += 1

        if srd_match:
            stats["srd_matched"] += 1

            # ── 3. 补充 proficiencies ──
            if "proficiencies" not in m or not m.get("proficiencies"):
                profs = extract_proficiencies(srd_match)
                if profs["savingThrows"] or profs["skills"]:
                    m["proficiencies"] = profs
                    stats["proficiencies_added"] += 1

            # ── 4. 补充 acType ──
            if "acType" not in m:
                ac_info = extract_ac_info(srd_match)
                if ac_info:
                    m["acType"] = ac_info.get("type", "natural")
                    if "armor" in ac_info:
                        m["acArmor"] = ac_info["armor"]
                    stats["ac_type_added"] += 1

            # ── 5. 伤害抗性/免疫 → 数组（从 SRD 取） ──
            srd_dr = srd_match.get("damage_resistances", [])
            srd_di = srd_match.get("damage_immunities", [])
            srd_dv = srd_match.get("damage_vulnerabilities", [])
            srd_ci = srd_match.get("condition_immunities", [])

            m["damageResistances"] = extract_damage_array(srd_dr)
            m["damageImmunities"] = extract_damage_array(srd_di)
            m["damageVulnerabilities"] = extract_damage_array(srd_dv)
            m["conditionImmunities"] = extract_condition_array(srd_ci)
            stats["damage_arrays_fixed"] += 1

            # ── 6. 补充 senses ──
            if not m.get("senses") or m.get("senses") == {}:
                srd_senses = extract_senses(srd_match)
                if srd_senses:
                    m["senses"] = srd_senses
                    stats["senses_enriched"] += 1

            # ── 7. 补充 languages ──
            if not m.get("languages") or m.get("languages") == []:
                srd_langs = srd_match.get("languages", "")
                if srd_langs:
                    m["languages"] = [l.strip() for l in srd_langs.split(",") if l.strip()]

        else:
            # 非 SRD 怪物 → 收集需要 LLM 处理的
            monsters_needing_llm_prof.append(m)

            # 尝试程序化解析伤害字符串
            fields_for_llm = {}
            for field in ["damageResistances", "damageImmunities", "conditionImmunities"]:
                raw = m.get(field)
                if raw and isinstance(raw, str):
                    if field == "conditionImmunities":
                        parsed = parse_chinese_condition_string(raw)
                    else:
                        parsed = parse_chinese_damage_string(raw)

                    if parsed is None:
                        fields_for_llm[field] = raw
                    elif isinstance(parsed, dict):
                        # 有非魔法抗性标记
                        m[field] = parsed.get("types", [])
                        m[f"{field}Note"] = "nonmagical bludgeoning, piercing, slashing"
                    else:
                        m[field] = parsed

            # 确保 damageVulnerabilities 存在
            if "damageVulnerabilities" not in m:
                m["damageVulnerabilities"] = []

            if fields_for_llm:
                monsters_needing_llm_damage.append((m["id"], fields_for_llm))

    print(f"  ✅ SRD 匹配: {stats['srd_matched']}")
    print(f"  ✅ CR 修复: {stats['cr_fixed']}")
    print(f"  ✅ 重复字段移除: {stats['duplicates_removed']}")
    print(f"  ✅ 熟练项补充: {stats['proficiencies_added']}")
    print(f"  ✅ AC 类型补充: {stats['ac_type_added']}")
    print(f"  ✅ 伤害数组修复: {stats['damage_arrays_fixed']}")
    print(f"  ✅ 感官补充: {stats['senses_enriched']}")
    print(f"  📋 需要 LLM 解析伤害文本: {len(monsters_needing_llm_damage)}")
    print(f"  📋 需要 LLM 生成熟练项: {len(monsters_needing_llm_prof)}")

    # Phase 2: LLM 处理
    print("\n📌 Phase 2: LLM 批处理")

    if monsters_needing_llm_damage:
        print(f"  🤖 解析伤害/状态文本 ({len(monsters_needing_llm_damage)} 只)...")
        llm_damage_results = batch_llm_parse_damage(monsters_needing_llm_damage)
        print(f"  ✅ LLM 返回 {len(llm_damage_results)} 条结果")

        # 应用 LLM 结果
        monster_map = {m["id"]: m for m in monsters}
        for mid, result in llm_damage_results.items():
            if mid in monster_map:
                m = monster_map[mid]
                for field in ["damageResistances", "damageImmunities",
                              "damageVulnerabilities", "conditionImmunities"]:
                    if field in result:
                        m[field] = result[field]
                if result.get("nonmagicalResistance"):
                    m["damageResistancesNote"] = "nonmagical bludgeoning, piercing, slashing"
                    if result.get("nonmagicalResistanceTypes"):
                        # 合并非魔法类型到 damageResistances
                        existing = set(m.get("damageResistances", []))
                        for t in result["nonmagicalResistanceTypes"]:
                            existing.add(t)
                        m["damageResistances"] = list(existing)
                stats["llm_processed"] += 1

    if monsters_needing_llm_prof:
        print(f"  🤖 生成熟练项 ({len(monsters_needing_llm_prof)} 只)...")
        llm_prof_results = batch_llm_generate_proficiencies(monsters_needing_llm_prof)
        print(f"  ✅ LLM 返回 {len(llm_prof_results)} 条结果")

        monster_map = {m["id"]: m for m in monsters}
        for mid, result in llm_prof_results.items():
            if mid in monster_map:
                m = monster_map[mid]
                if "proficiencies" not in m or not m.get("proficiencies"):
                    m["proficiencies"] = {
                        "savingThrows": result.get("savingThrows", {}),
                        "skills": result.get("skills", {}),
                    }

    # Phase 3: 最终清理
    print("\n📌 Phase 3: 最终清理")
    for m in monsters:
        # 确保所有数组字段存在
        for field in ["damageResistances", "damageImmunities",
                       "damageVulnerabilities", "conditionImmunities"]:
            val = m.get(field)
            if val is None or val == "":
                m[field] = []
            elif isinstance(val, str):
                # 还有残留字符串的，设为空数组并记录
                stats["errors"].append(f"{m['id']}.{field} still string: {val[:50]}")
                m[field] = []

        # 确保 proficiencies 存在
        if "proficiencies" not in m:
            m["proficiencies"] = {"savingThrows": {}, "skills": {}}

        # 确保 acType 存在
        if "acType" not in m:
            m["acType"] = "unknown"

    # 保存
    our_data["monsters"] = monsters
    our_data["overview"]["lastOptimized"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    our_data["overview"]["optimizationNote"] = (
        "Enriched with SRD proficiencies, AC types, structured damage/condition arrays. "
        "Removed duplicate ability score fields."
    )
    save_json(OUTPUT_PATH, our_data)
    save_json(LOG_PATH, stats)

    # 报告
    print("\n" + "=" * 60)
    print("📊 优化报告")
    print(f"  总怪物数: {stats['total']}")
    print(f"  SRD 匹配: {stats['srd_matched']}")
    print(f"  LLM 处理: {stats['llm_processed']}")
    print(f"  CR 修复: {stats['cr_fixed']}")
    print(f"  重复字段移除: {stats['duplicates_removed']}")
    print(f"  熟练项补充: {stats['proficiencies_added']}")
    print(f"  AC 类型补充: {stats['ac_type_added']}")
    print(f"  伤害数组修复: {stats['damage_arrays_fixed']}")
    print(f"  感官补充: {stats['senses_enriched']}")
    if stats["errors"]:
        print(f"  ⚠️ 错误: {len(stats['errors'])}")
        for e in stats["errors"][:10]:
            print(f"    - {e}")
    print(f"\n📁 输出: {OUTPUT_PATH}")
    print(f"📁 日志: {LOG_PATH}")


if __name__ == "__main__":
    optimize_monsters()
