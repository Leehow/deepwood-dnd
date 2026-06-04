#!/usr/bin/env python3
"""
Cross-validate our D&D 5E data against SRD JSON reference data.
Compares: Equipment (weapons/armor), Magic Items, Monsters
"""
import json
import re
import sys
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).parent.parent

# === File paths ===
SRD_DIR = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd"
OUR_EQUIPMENT = PROJECT_ROOT / "frontend" / "app" / "data" / "rules" / "equipment.json"
OUR_MAGIC_ITEMS = PROJECT_ROOT / "frontend" / "public" / "rules" / "magic-items.json"
OUR_MONSTERS = PROJECT_ROOT / "dnd-platform" / "configs" / "npc" / "monsters.json"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def normalize_name(name: str) -> str:
    """Normalize English name for matching."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


# ============================================================
# 1. EQUIPMENT VALIDATION
# ============================================================
def validate_equipment():
    print("=" * 70)
    print("EQUIPMENT CROSS-VALIDATION")
    print("=" * 70)

    srd_items = load_json(SRD_DIR / "5e-SRD-Equipment.json")
    our_data = load_json(OUR_EQUIPMENT)

    # Build our lookup by normalized English name
    our_lookup = {}

    # Armor
    for category in ["light", "medium", "heavy"]:
        for item in our_data.get("armor", {}).get(category, []):
            if item.get("nameEn"):
                our_lookup[normalize_name(item["nameEn"])] = {
                    "type": "armor", "data": item
                }
    for item in our_data.get("armor", {}).get("shield", []):
        if item.get("nameEn"):
            our_lookup[normalize_name(item["nameEn"])] = {
                "type": "shield", "data": item
            }

    # Weapons
    for category in ["simple", "martial"]:
        weapons = our_data.get("weapons", {}).get(category, {})
        for subcategory in ["melee", "ranged"]:
            for item in weapons.get(subcategory, []):
                if item.get("nameEn"):
                    our_lookup[normalize_name(item["nameEn"])] = {
                        "type": "weapon", "data": item
                    }

    # Adventuring gear - flatten all subcategories
    for subcat_name, items in our_data.get("adventuringGear", {}).items():
        if isinstance(items, list):
            for item in items:
                if item.get("nameEn"):
                    our_lookup[normalize_name(item["nameEn"])] = {
                        "type": "gear", "data": item
                    }

    # Tools
    for subcat_name, items in our_data.get("tools", {}).items():
        if isinstance(items, list):
            for item in items:
                if item.get("nameEn"):
                    our_lookup[normalize_name(item["nameEn"])] = {
                        "type": "tool", "data": item
                    }

    # Mounts
    for item in our_data.get("mounts", {}).get("animals", []):
        if item.get("nameEn"):
            our_lookup[normalize_name(item["nameEn"])] = {
                "type": "mount", "data": item
            }

    # Vehicles
    for subcat in ["land", "water"]:
        for item in our_data.get("vehicles", {}).get(subcat, []):
            if item.get("nameEn"):
                our_lookup[normalize_name(item["nameEn"])] = {
                    "type": "vehicle", "data": item
                }

    # Cost conversion: SRD uses {quantity, unit}, we use {gp/sp/cp} or costCopper
    def srd_cost_to_copper(cost):
        if not cost:
            return None
        q = cost.get("quantity", 0)
        u = cost.get("unit", "gp")
        rates = {"cp": 1, "sp": 10, "ep": 50, "gp": 100, "pp": 1000}
        return q * rates.get(u, 100)

    def our_cost_to_copper(item):
        if "costCopper" in item:
            return item["costCopper"]
        cost = item.get("cost", {})
        if isinstance(cost, dict):
            total = 0
            total += cost.get("cp", 0) * 1
            total += cost.get("sp", 0) * 10
            total += cost.get("ep", 0) * 50
            total += cost.get("gp", 0) * 100
            total += cost.get("pp", 0) * 1000
            return total if total > 0 else None
        return None

    issues = []
    matched = 0
    unmatched_srd = []

    for srd_item in srd_items:
        srd_name = srd_item["name"]
        key = normalize_name(srd_name)
        srd_cat = srd_item.get("equipment_category", {}).get("name", "")

        if key not in our_lookup:
            unmatched_srd.append(f"  {srd_name} ({srd_cat})")
            continue

        matched += 1
        ours = our_lookup[key]["data"]
        item_type = our_lookup[key]["type"]

        # Compare cost
        srd_copper = srd_cost_to_copper(srd_item.get("cost"))
        our_copper = our_cost_to_copper(ours)
        if srd_copper and our_copper and srd_copper != our_copper:
            issues.append({
                "item": srd_name,
                "field": "cost",
                "srd": f"{srd_copper}cp ({srd_item['cost']['quantity']} {srd_item['cost']['unit']})",
                "ours": f"{our_copper}cp",
                "cn_name": ours.get("name", "")
            })

        # Compare weight
        srd_weight = srd_item.get("weight")
        our_weight = ours.get("weight")
        if srd_weight is not None and our_weight is not None:
            if abs(float(srd_weight) - float(our_weight)) > 0.01:
                issues.append({
                    "item": srd_name,
                    "field": "weight",
                    "srd": srd_weight,
                    "ours": our_weight,
                    "cn_name": ours.get("name", "")
                })

        # Weapons: compare damage dice
        if item_type == "weapon" and "damage" in srd_item:
            srd_dice = srd_item["damage"].get("damage_dice", "")
            our_dice = ours.get("damage", "")
            srd_dmg_type = srd_item["damage"].get("damage_type", {}).get("name", "")
            our_dmg_type = ours.get("damageType", "")

            if srd_dice and our_dice and srd_dice != our_dice:
                issues.append({
                    "item": srd_name,
                    "field": "damage_dice",
                    "srd": srd_dice,
                    "ours": our_dice,
                    "cn_name": ours.get("name", "")
                })

        # Armor: compare AC
        if item_type == "armor":
            srd_ac_obj = srd_item.get("armor_class", {})
            srd_ac_base = srd_ac_obj.get("base") if isinstance(srd_ac_obj, dict) else None
            our_ac_formula = ours.get("acFormula", {})
            our_ac_base = our_ac_formula.get("base") if isinstance(our_ac_formula, dict) else None
            if srd_ac_base and our_ac_base and srd_ac_base != our_ac_base:
                issues.append({
                    "item": srd_name,
                    "field": "AC base",
                    "srd": srd_ac_base,
                    "ours": our_ac_base,
                    "cn_name": ours.get("name", "")
                })

    print(f"\nSRD items: {len(srd_items)} | Matched: {matched} | Unmatched: {len(unmatched_srd)}")
    print(f"Issues found: {len(issues)}")

    if issues:
        print(f"\n{'Item':<30} {'Field':<14} {'SRD':<20} {'Ours':<20} CN Name")
        print("-" * 100)
        for issue in issues:
            print(f"{issue['item']:<30} {issue['field']:<14} {str(issue['srd']):<20} {str(issue['ours']):<20} {issue['cn_name']}")

    if unmatched_srd:
        print(f"\nSRD items not found in our data ({len(unmatched_srd)}):")
        for name in unmatched_srd[:30]:
            print(name)
        if len(unmatched_srd) > 30:
            print(f"  ... and {len(unmatched_srd) - 30} more")

    return issues


# ============================================================
# 2. MAGIC ITEMS VALIDATION
# ============================================================
def validate_magic_items():
    print("\n" + "=" * 70)
    print("MAGIC ITEMS CROSS-VALIDATION")
    print("=" * 70)

    srd_items = load_json(SRD_DIR / "5e-SRD-Magic-Items.json")
    our_data = load_json(OUR_MAGIC_ITEMS)
    our_items = our_data.get("items", our_data) if isinstance(our_data, dict) else our_data

    # Build lookup
    our_lookup = {}
    for item in our_items:
        if item.get("nameEn"):
            our_lookup[normalize_name(item["nameEn"])] = item

    issues = []
    matched = 0
    unmatched_srd = []

    for srd_item in srd_items:
        srd_name = srd_item["name"]
        key = normalize_name(srd_name)

        if key not in our_lookup:
            unmatched_srd.append(srd_name)
            continue

        matched += 1
        ours = our_lookup[key]

        # Compare rarity
        srd_rarity = srd_item.get("rarity", {}).get("name", "").lower()
        our_rarity = (ours.get("rarity") or "").lower()
        if srd_rarity and our_rarity and srd_rarity != our_rarity:
            issues.append({
                "item": srd_name,
                "field": "rarity",
                "srd": srd_rarity,
                "ours": our_rarity,
                "cn_name": ours.get("name", "")
            })

        # Compare attunement
        srd_desc = " ".join(srd_item.get("desc", []))
        srd_attune = "requires attunement" in srd_desc.lower()
        our_attune = ours.get("requiresAttunement", False)
        if srd_attune != our_attune:
            issues.append({
                "item": srd_name,
                "field": "attunement",
                "srd": srd_attune,
                "ours": our_attune,
                "cn_name": ours.get("name", "")
            })

        # Compare category
        srd_cat = srd_item.get("equipment_category", {}).get("name", "").lower()
        our_cat = (ours.get("category") or "").lower()
        if srd_cat and our_cat and srd_cat != our_cat:
            issues.append({
                "item": srd_name,
                "field": "category",
                "srd": srd_cat,
                "ours": our_cat,
                "cn_name": ours.get("name", "")
            })

    print(f"\nSRD items: {len(srd_items)} | Matched: {matched} | Unmatched: {len(unmatched_srd)}")
    print(f"Issues found: {len(issues)}")

    if issues:
        print(f"\n{'Item':<40} {'Field':<12} {'SRD':<20} {'Ours':<20} CN Name")
        print("-" * 110)
        for issue in issues:
            print(f"{issue['item']:<40} {issue['field']:<12} {str(issue['srd']):<20} {str(issue['ours']):<20} {issue['cn_name']}")

    if unmatched_srd:
        print(f"\nSRD items not found in our data ({len(unmatched_srd)}):")
        for name in unmatched_srd[:20]:
            print(f"  {name}")
        if len(unmatched_srd) > 20:
            print(f"  ... and {len(unmatched_srd) - 20} more")

    return issues


# ============================================================
# 3. MONSTERS VALIDATION
# ============================================================
def validate_monsters():
    print("\n" + "=" * 70)
    print("MONSTERS CROSS-VALIDATION")
    print("=" * 70)

    srd_monsters = load_json(SRD_DIR / "5e-SRD-Monsters.json")
    our_data = load_json(OUR_MONSTERS)
    our_monsters = our_data.get("monsters", [])

    # Build lookup
    our_lookup = {}
    for m in our_monsters:
        if m.get("nameEn"):
            our_lookup[normalize_name(m["nameEn"])] = m

    issues = []
    matched = 0
    unmatched_srd = []

    for srd_m in srd_monsters:
        srd_name = srd_m["name"]
        key = normalize_name(srd_name)

        if key not in our_lookup:
            unmatched_srd.append(f"  {srd_name} (CR {srd_m.get('challenge_rating', '?')})")
            continue

        matched += 1
        ours = our_lookup[key]

        # Compare AC
        srd_ac_list = srd_m.get("armor_class", [])
        srd_ac = srd_ac_list[0].get("value") if srd_ac_list and isinstance(srd_ac_list[0], dict) else None
        our_ac = ours.get("ac")
        if srd_ac is not None and our_ac is not None and int(srd_ac) != int(our_ac):
            issues.append({
                "monster": srd_name,
                "field": "AC",
                "srd": srd_ac,
                "ours": our_ac,
                "cn_name": ours.get("name", "")
            })

        # Compare HP
        srd_hp = srd_m.get("hit_points")
        our_hp = ours.get("hp")
        if srd_hp is not None and our_hp is not None and int(srd_hp) != int(our_hp):
            issues.append({
                "monster": srd_name,
                "field": "HP",
                "srd": srd_hp,
                "ours": our_hp,
                "cn_name": ours.get("name", "")
            })

        # Compare hit dice formula
        srd_hd = srd_m.get("hit_points_roll", "")
        our_hd = ours.get("hpFormula", "")
        if srd_hd and our_hd:
            # Normalize: remove spaces
            srd_hd_n = re.sub(r'\s+', '', srd_hd)
            our_hd_n = re.sub(r'\s+', '', our_hd)
            if srd_hd_n != our_hd_n:
                issues.append({
                    "monster": srd_name,
                    "field": "HP Formula",
                    "srd": srd_hd,
                    "ours": our_hd,
                    "cn_name": ours.get("name", "")
                })

        # Compare ability scores
        ability_map = {
            "strength": "str", "dexterity": "dex", "constitution": "con",
            "intelligence": "int", "wisdom": "wis", "charisma": "cha"
        }
        our_abs = ours.get("abilityScores", {})
        for srd_key, our_key in ability_map.items():
            srd_val = srd_m.get(srd_key)
            our_val = our_abs.get(our_key)
            if srd_val is not None and our_val is not None and int(srd_val) != int(our_val):
                issues.append({
                    "monster": srd_name,
                    "field": srd_key.upper()[:3],
                    "srd": srd_val,
                    "ours": our_val,
                    "cn_name": ours.get("name", "")
                })

        # Compare CR
        srd_cr = srd_m.get("challenge_rating")
        our_cr = ours.get("cr")
        if srd_cr is not None and our_cr is not None:
            try:
                if float(srd_cr) != float(our_cr):
                    issues.append({
                        "monster": srd_name,
                        "field": "CR",
                        "srd": srd_cr,
                        "ours": our_cr,
                        "cn_name": ours.get("name", "")
                    })
            except (ValueError, TypeError):
                pass

        # Compare XP
        srd_xp = srd_m.get("xp")
        our_xp = ours.get("xp")
        if srd_xp is not None and our_xp is not None and int(srd_xp) != int(our_xp):
            issues.append({
                "monster": srd_name,
                "field": "XP",
                "srd": srd_xp,
                "ours": our_xp,
                "cn_name": ours.get("name", "")
            })

        # Compare speed
        srd_speed = srd_m.get("speed", {})
        our_speed = ours.get("speed", {})
        for move_type in ["walk", "fly", "swim", "burrow", "climb"]:
            srd_spd = srd_speed.get(move_type, "")
            our_spd = our_speed.get(move_type)
            if srd_spd and our_spd is not None:
                # SRD: "40 ft." -> 40
                srd_num = re.search(r'(\d+)', str(srd_spd))
                if srd_num:
                    srd_val = int(srd_num.group(1))
                    if srd_val != int(our_spd):
                        issues.append({
                            "monster": srd_name,
                            "field": f"Speed({move_type})",
                            "srd": srd_spd,
                            "ours": our_spd,
                            "cn_name": ours.get("name", "")
                        })

    print(f"\nSRD monsters: {len(srd_monsters)} | Matched: {matched} | Unmatched: {len(unmatched_srd)}")
    print(f"Issues found: {len(issues)}")

    # Group issues by type
    by_field = defaultdict(list)
    for issue in issues:
        by_field[issue["field"]].append(issue)

    for field, field_issues in sorted(by_field.items()):
        print(f"\n--- {field} mismatches ({len(field_issues)}) ---")
        print(f"{'Monster':<30} {'SRD':<20} {'Ours':<20} CN Name")
        print("-" * 90)
        for issue in field_issues[:30]:
            print(f"{issue['monster']:<30} {str(issue['srd']):<20} {str(issue['ours']):<20} {issue['cn_name']}")
        if len(field_issues) > 30:
            print(f"... and {len(field_issues) - 30} more")

    if unmatched_srd:
        print(f"\nSRD monsters not found in our data ({len(unmatched_srd)}):")
        for name in unmatched_srd[:20]:
            print(name)
        if len(unmatched_srd) > 20:
            print(f"  ... and {len(unmatched_srd) - 20} more")

    return issues


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    all_issues = {}

    eq_issues = validate_equipment()
    all_issues["equipment"] = eq_issues

    mi_issues = validate_magic_items()
    all_issues["magic_items"] = mi_issues

    mon_issues = validate_monsters()
    all_issues["monsters"] = mon_issues

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total = sum(len(v) for v in all_issues.values())
    for cat, items in all_issues.items():
        print(f"  {cat}: {len(items)} issues")
    print(f"  TOTAL: {total} issues")

    # Save results
    output_path = PROJECT_ROOT / "scripts" / "cross_validate_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_issues, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nDetailed results saved to: {output_path}")
