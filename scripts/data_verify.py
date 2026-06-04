#!/usr/bin/env python3
"""
装备/魔法物品/怪物 批量校对脚本
对比 SRD 英文原文和我们的中文数据，检查数值参数是否一致。
"""

import json
import time
import sys
import os
import httpx

sys.stdout.reconfigure(line_buffering=True)

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.2"

BATCH_SIZE = 5
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def call_llm(prompt, retry=2):
    for attempt in range(retry + 1):
        try:
            resp = httpx.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1, "max_tokens": 4096},
                timeout=120,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            return json.loads(content.strip())
        except Exception as e:
            print(f"  [Attempt {attempt+1}] Error: {e}")
            if attempt < retry:
                time.sleep(3)
    return None


# ============================================================
# Equipment verification
# ============================================================
def verify_equipment():
    print("\n" + "=" * 60)
    print("装备校对")
    print("=" * 60)

    with open(os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Equipment.json")) as f:
        srd_list = json.load(f)
    srd_map = {s["name"]: s for s in srd_list}

    with open(os.path.join(PROJECT_ROOT, "frontend/app/data/rules/equipment.json")) as f:
        our_data = json.load(f)

    # Flatten our equipment into a list with nameEn
    our_items = []
    # Weapons
    for cat in ["simple", "martial"]:
        for wtype in ["melee", "ranged"]:
            items = our_data.get("weapons", {}).get(cat, {}).get(wtype, [])
            for item in items:
                if item.get("nameEn"):
                    our_items.append(item)
    # Armor
    for atype in our_data.get("armor", {}).get("types", []):
        for item in atype.get("items", []):
            if item.get("nameEn"):
                our_items.append(item)
    # Adventuring gear
    for cat in our_data.get("adventuringGear", {}).get("categories", []):
        for item in cat.get("items", []):
            if item.get("nameEn"):
                our_items.append(item)
    # Tools
    for cat in our_data.get("tools", {}).get("categories", []):
        for item in cat.get("items", []):
            if item.get("nameEn"):
                our_items.append(item)

    our_map = {item["nameEn"]: item for item in our_items}
    overlap = sorted(set(srd_map.keys()) & set(our_map.keys()))
    print(f"SRD: {len(srd_map)} | 我们: {len(our_map)} | 重叠: {len(overlap)}")

    # First do structural field comparison
    print("\n--- 结构字段对比 ---")
    struct_diffs = []
    for name in overlap:
        s = srd_map[name]
        o = our_map[name]
        diffs = []
        # Cost
        srd_cost_gp = s.get("cost", {}).get("quantity", 0)
        srd_cost_unit = s.get("cost", {}).get("unit", "gp")
        if srd_cost_unit == "cp":
            srd_cost_gp = srd_cost_gp / 100
        elif srd_cost_unit == "sp":
            srd_cost_gp = srd_cost_gp / 10
        our_cost_gp = o.get("cost", {}).get("gp", 0) or (o.get("costCopper", 0) / 100)
        if abs(srd_cost_gp - our_cost_gp) > 0.01:
            diffs.append(f"价格: SRD={srd_cost_gp}gp vs 我们={our_cost_gp}gp")
        # Weight
        srd_weight = s.get("weight", 0)
        our_weight = o.get("weight", 0)
        if srd_weight and our_weight and srd_weight != our_weight:
            diffs.append(f"重量: SRD={srd_weight} vs 我们={our_weight}")
        # Damage (weapons)
        if "damage" in s:
            srd_dmg = s["damage"].get("damage_dice", "")
            our_dmg = o.get("damage", "")
            if srd_dmg != our_dmg:
                diffs.append(f"伤害: SRD={srd_dmg} vs 我们={our_dmg}")
        # Damage type
        if "damage" in s:
            srd_dtype = s["damage"].get("damage_type", {}).get("index", "")
            our_dtype = o.get("damageType", "")
            if srd_dtype and our_dtype and srd_dtype != our_dtype:
                diffs.append(f"伤害类型: SRD={srd_dtype} vs 我们={our_dtype}")
        # AC (armor)
        if "armor_class" in s:
            srd_ac = s["armor_class"].get("base", 0)
            our_ac = o.get("baseAC", 0) or o.get("ac", 0)
            if srd_ac and our_ac and srd_ac != our_ac:
                diffs.append(f"AC: SRD={srd_ac} vs 我们={our_ac}")

        if diffs:
            struct_diffs.append({"name": name, "name_cn": o.get("name", ""), "diffs": diffs})
            print(f"  {name} ({o.get('name','')}): {'; '.join(diffs)}")

    print(f"\n结构字段差异: {len(struct_diffs)} 个装备")
    return struct_diffs, overlap, srd_map, our_map


# ============================================================
# Magic Items verification
# ============================================================
def verify_magic_items():
    print("\n" + "=" * 60)
    print("魔法物品校对")
    print("=" * 60)

    with open(os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Magic-Items.json")) as f:
        srd_list = json.load(f)
    srd_map = {s["name"]: s for s in srd_list}

    with open(os.path.join(PROJECT_ROOT, "frontend/public/rules/magic-items.json")) as f:
        our_data = json.load(f)
    our_items = our_data.get("items", [])
    our_map = {item["nameEn"]: item for item in our_items if item.get("nameEn")}

    overlap = sorted(set(srd_map.keys()) & set(our_map.keys()))
    print(f"SRD: {len(srd_map)} | 我们: {len(our_map)} | 重叠: {len(overlap)}")

    # Structural: rarity check
    print("\n--- 稀有度对比 ---")
    rarity_diffs = []
    for name in overlap:
        s = srd_map[name]
        o = our_map[name]
        srd_rarity = s.get("rarity", {}).get("name", "").lower()
        our_rarity = (o.get("rarity", "") or "").lower()
        if srd_rarity and our_rarity and srd_rarity != our_rarity:
            rarity_diffs.append({"name": name, "name_cn": o.get("name", ""), "srd": srd_rarity, "ours": our_rarity})
            print(f"  {name} ({o.get('name','')}): SRD={srd_rarity} vs 我们={our_rarity}")

    print(f"稀有度差异: {len(rarity_diffs)} 个")

    # LLM description verification (batch)
    print("\n--- 描述校对 (LLM) ---")
    all_results = []
    errors_found = []
    batches = []
    batch = []
    for name in overlap:
        s = srd_map[name]
        o = our_map[name]
        srd_desc = "\n".join(s.get("desc", []))
        our_desc = o.get("description", "")
        if not srd_desc or not our_desc:
            continue
        batch.append((name, srd_desc, our_desc, o.get("name", "")))
        if len(batch) >= BATCH_SIZE:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    print(f"分为 {len(batches)} 批")
    for i, batch in enumerate(batches):
        names = [b[0] for b in batch]
        print(f"[{i+1}/{len(batches)}] {', '.join(names[:3])}...")

        items_text = ""
        for j, (name, srd_desc, our_desc, name_cn) in enumerate(batch, 1):
            items_text += f"""
--- 物品 {j}: {name} ({name_cn}) ---
【SRD 英文原文】
{srd_desc}

【我们的中文描述】
{our_desc}

"""
        prompt = f"""你是 D&D 5E 魔法物品校对专家。对比以下物品的 SRD 英文原文和中文描述，只检查数值参数是否一致。

只检查：数值（加值/骰子/距离/持续时间/充能数）、豁免DC、效果条件、关键规则遗漏
不检查：翻译风格、用词习惯、语序

{items_text}

JSON 数组回复：
```json
[{{"name_en": "名", "name_cn": "名", "status": "ok"或"error", "issues": ["简短描述"]}}]
```
数值参数都正确则 status="ok"。"""

        results = call_llm(prompt)
        if results:
            all_results.extend(results)
            for r in results:
                if r.get("status") == "error":
                    errors_found.append(r)
                    print(f"  !! {r['name_en']}: {r['issues']}")
                else:
                    print(f"  OK {r['name_en']}")
        else:
            print(f"  FAILED")
        if i < len(batches) - 1:
            time.sleep(1)

    return {"rarity_diffs": rarity_diffs, "description_errors": errors_found, "total_checked": len(all_results)}


# ============================================================
# Monsters verification
# ============================================================
def verify_monsters():
    print("\n" + "=" * 60)
    print("怪物校对")
    print("=" * 60)

    with open(os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Monsters.json")) as f:
        srd_list = json.load(f)
    srd_map = {s["name"]: s for s in srd_list}

    with open(os.path.join(PROJECT_ROOT, "frontend/public/rules/monsters.json")) as f:
        our_data = json.load(f)
    our_monsters = our_data.get("monsters", [])
    our_map = {m["nameEn"]: m for m in our_monsters if m.get("nameEn")}

    overlap = sorted(set(srd_map.keys()) & set(our_map.keys()))
    print(f"SRD: {len(srd_map)} | 我们: {len(our_map)} | 重叠: {len(overlap)}")

    # Structural fields comparison
    print("\n--- 结构字段对比 ---")
    struct_diffs = []
    for name in overlap:
        s = srd_map[name]
        o = our_map[name]
        diffs = []

        # HP
        if s.get("hit_points") and o.get("hp") and s["hit_points"] != o["hp"]:
            diffs.append(f"HP: SRD={s['hit_points']} vs 我们={o['hp']}")
        # AC
        srd_ac = s["armor_class"][0]["value"] if s.get("armor_class") else None
        our_ac = o.get("ac")
        if srd_ac and our_ac and srd_ac != our_ac:
            diffs.append(f"AC: SRD={srd_ac} vs 我们={our_ac}")
        # CR
        srd_cr = str(s.get("challenge_rating", ""))
        our_cr = str(o.get("cr", ""))
        if srd_cr and our_cr and srd_cr != our_cr:
            diffs.append(f"CR: SRD={srd_cr} vs 我们={our_cr}")
        # Ability scores
        for attr in ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]:
            short = attr[:3]
            srd_val = s.get(attr, 0)
            our_val = o.get(short, 0)
            if srd_val and our_val and srd_val != our_val:
                diffs.append(f"{attr}: SRD={srd_val} vs 我们={our_val}")
        # Speed
        srd_walk = int(s.get("speed", {}).get("walk", "0 ft.").replace(" ft.", "").replace("ft.", "") or 0)
        our_walk = o.get("speed", {}).get("walk", 0)
        if srd_walk and our_walk and srd_walk != our_walk:
            diffs.append(f"速度: SRD={srd_walk} vs 我们={our_walk}")

        if diffs:
            struct_diffs.append({"name": name, "name_cn": o.get("name", ""), "diffs": diffs})
            print(f"  {name} ({o.get('name','')}): {'; '.join(diffs)}")

    print(f"\n结构字段差异: {len(struct_diffs)} 个怪物")

    # LLM verify actions/abilities descriptions (sample the ones with struct diffs + random)
    # For monsters, focus on actions damage values
    print("\n--- 动作/能力描述校对 (LLM) ---")
    all_results = []
    errors_found = []

    batches = []
    batch = []
    for name in overlap:
        s = srd_map[name]
        o = our_map[name]
        # Build SRD actions text
        srd_actions = ""
        for a in s.get("actions", []):
            desc = a.get("desc", "")
            srd_actions += f"  {a['name']}: {desc}\n"
        for a in s.get("special_abilities", []):
            desc = a.get("desc", "")
            srd_actions += f"  {a['name']}: {desc}\n"
        # Build our actions text
        our_actions = ""
        for a in o.get("actions", []):
            our_actions += f"  {a.get('name','')}: {a.get('description','')}\n"
        for a in o.get("specialAbilities", []):
            our_actions += f"  {a.get('name','')}: {a.get('description','')}\n"

        if not srd_actions or not our_actions:
            continue
        batch.append((name, srd_actions, our_actions, o.get("name", "")))
        if len(batch) >= BATCH_SIZE:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    print(f"分为 {len(batches)} 批")
    for i, batch in enumerate(batches):
        names = [b[0] for b in batch]
        print(f"[{i+1}/{len(batches)}] {', '.join(names[:3])}...")

        items_text = ""
        for j, (name, srd_text, our_text, name_cn) in enumerate(batch, 1):
            items_text += f"""
--- 怪物 {j}: {name} ({name_cn}) ---
【SRD 动作/能力原文】
{srd_text}
【我们的中文动作/能力】
{our_text}
"""
        prompt = f"""你是 D&D 5E 怪物数据校对专家。对比以下怪物的 SRD 英文原文和中文描述，只检查数值参数。

只检查：攻击加值、伤害骰/伤害值、触及距离、豁免DC、充能条件、范围数值
不检查：翻译风格、名称翻译

{items_text}

JSON 数组回复：
```json
[{{"name_en": "名", "name_cn": "名", "status": "ok"或"error", "issues": ["简短描述"]}}]
```"""

        results = call_llm(prompt)
        if results:
            all_results.extend(results)
            for r in results:
                if r.get("status") == "error":
                    errors_found.append(r)
                    print(f"  !! {r['name_en']}: {r['issues']}")
                else:
                    print(f"  OK {r['name_en']}")
        else:
            print(f"  FAILED")
        if i < len(batches) - 1:
            time.sleep(1)

    return {"struct_diffs": struct_diffs, "action_errors": errors_found, "total_checked": len(all_results)}


# ============================================================
# Main
# ============================================================
def main():
    results = {}

    # 1. Equipment
    equip_struct, equip_overlap, _, _ = verify_equipment()
    results["equipment"] = {"struct_diffs": equip_struct, "overlap": len(equip_overlap)}

    # 2. Magic Items
    mi_results = verify_magic_items()
    results["magic_items"] = mi_results

    # 3. Monsters
    mon_results = verify_monsters()
    results["monsters"] = mon_results

    # Save
    output_path = os.path.join(PROJECT_ROOT, "scripts/data_verify_results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("全部校对完成")
    print("=" * 60)
    print(f"装备: {len(equip_struct)} 个结构差异")
    print(f"魔法物品: {mi_results.get('total_checked',0)} 个已检查, {len(mi_results.get('description_errors',[]))} 个描述问题, {len(mi_results.get('rarity_diffs',[]))} 个稀有度差异")
    print(f"怪物: {len(mon_results.get('struct_diffs',[]))} 个结构差异, {mon_results.get('total_checked',0)} 个已检查, {len(mon_results.get('action_errors',[]))} 个动作描述问题")
    print(f"结果已保存: {output_path}")


if __name__ == "__main__":
    main()
